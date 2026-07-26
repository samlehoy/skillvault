import fs from "node:fs";
import path from "node:path";
import { encodeInspection } from "../core/link-planner.js";
import {
  invertOperation,
  isPlanStale,
  type Operation,
  type Plan,
  type Precondition,
} from "../core/plan.js";
import { createBackup } from "../fs/backup.js";
import { createJunction, inspectPath, removeJunction } from "../fs/junction.js";
import { hashDirectory } from "../fs/hash.js";
import { writeJournalEntry, type JournalEntry } from "./journal.js";

/**
 * Plan executor (ARCHITECTURE.md, "Transactions and rollback"):
 *
 *   lock -> staleness check -> apply -> verify -> record
 *                               |
 *                               +-> rollback applied inverses on failure
 *
 * The executor re-observes every `inspect:` precondition itself; facts it
 * cannot observe (such as `vault:` content hashes) must be supplied via
 * `extraFacts`, otherwise the plan counts as stale — refusing to run on
 * unverifiable assumptions is the safe default.
 *
 * The `backup` operation is an evacuation (copy, verify, then remove the
 * source); its inverse `restore` moves the content back and consumes the
 * backup. Rollback executes recorded inverses in reverse order and reports —
 * never hides — anything it could not restore.
 */

export interface TransactionRecord {
  readonly planId: string;
  readonly applied: readonly Operation[];
  readonly rolledBack: boolean;
  readonly rollbackErrors: readonly string[];
}

export interface TransactionError {
  readonly code:
    | "transaction/locked"
    | "transaction/stale"
    | "transaction/unsupported-operation"
    | "transaction/operation-failed";
  readonly message: string;
}

export type TransactionResult =
  | { readonly ok: true; readonly record: TransactionRecord }
  | {
      readonly ok: false;
      readonly error: TransactionError;
      readonly record: TransactionRecord;
    };

export interface ExecutorEnvironment {
  readonly backupsRoot: string;
  readonly locksRoot: string;
  readonly extraFacts?: readonly Precondition[];
  /**
   * When set, every mutation writes a persistent journal entry here
   * (`<stateRoot>/transactions/<planId>.json`), updated as operations
   * apply — a crash mid-run leaves an `in-progress` entry for recovery
   * detection. Production callers always set this.
   */
  readonly stateRoot?: string;
}

const SUPPORTED = new Set<Operation["kind"]>([
  "link-create",
  "link-remove",
  "backup",
  "restore",
]);

const LOCK_NAME = "mutation.lock";

function moveDirectory(source: string, dest: string): string | null {
  const backedUp = createBackup(source, dest);
  if (!backedUp.ok) return backedUp.error.message;
  try {
    fs.rmSync(source, { recursive: true });
    return null;
  } catch (error) {
    return `Copied but failed to remove source ${source}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function executeOperation(
  operation: Operation,
  env: ExecutorEnvironment,
): string | null {
  switch (operation.kind) {
    case "link-create": {
      const created = createJunction(operation.targetPath, operation.path);
      return created.ok ? null : created.error.message;
    }
    case "link-remove": {
      const inspection = inspectPath(operation.path);
      if (
        inspection.kind !== "junction" ||
        path.resolve(inspection.target) !== path.resolve(operation.targetPath)
      ) {
        return `Refusing link-remove: ${operation.path} is not a junction to ${operation.targetPath}.`;
      }
      const removed = removeJunction(operation.path);
      return removed.ok ? null : removed.error.message;
    }
    case "backup":
      return moveDirectory(
        operation.sourcePath,
        path.join(env.backupsRoot, operation.backupId),
      );
    case "restore":
      return moveDirectory(
        path.join(env.backupsRoot, operation.backupId),
        operation.targetPath,
      );
    default:
      return `Unsupported operation kind: ${operation.kind}`;
  }
}

function verifyOperation(operation: Operation): string | null {
  if (operation.kind === "link-create") {
    const inspection = inspectPath(operation.path);
    if (
      inspection.kind !== "junction" ||
      path.resolve(inspection.target) !== path.resolve(operation.targetPath) ||
      !inspection.targetExists
    ) {
      return `Post-condition failed: ${operation.path} is not a live junction to ${operation.targetPath}.`;
    }
    const targetHash = hashDirectory(operation.targetPath);
    if (!targetHash.ok) return targetHash.error.message;
  }
  return null;
}

export function applyPlan(
  plan: Plan,
  env: ExecutorEnvironment,
): TransactionResult {
  const emptyRecord: TransactionRecord = {
    planId: plan.id,
    applied: [],
    rolledBack: false,
    rollbackErrors: [],
  };
  const failed = (
    code: TransactionError["code"],
    message: string,
    record: TransactionRecord = emptyRecord,
  ): TransactionResult => ({ ok: false, error: { code, message }, record });

  const unsupported = plan.operations.find((op) => !SUPPORTED.has(op.kind));
  if (unsupported) {
    return failed(
      "transaction/unsupported-operation",
      `This executor cannot apply operation kind "${unsupported.kind}".`,
    );
  }

  const observed: Precondition[] = [
    ...plan.preconditions
      .filter((p) => p.key.startsWith("inspect:"))
      .map((p) => {
        const observedPath = p.key.slice("inspect:".length);
        return {
          key: p.key,
          value: encodeInspection(inspectPath(observedPath)),
        };
      }),
    ...(env.extraFacts ?? []),
  ];
  if (isPlanStale(plan, observed)) {
    return failed(
      "transaction/stale",
      "Plan preconditions no longer match observed state; re-plan before applying.",
    );
  }

  fs.mkdirSync(env.locksRoot, { recursive: true });
  const lockPath = path.join(env.locksRoot, LOCK_NAME);
  let lockFd: number;
  try {
    lockFd = fs.openSync(lockPath, "wx");
  } catch {
    return failed(
      "transaction/locked",
      `Another mutation holds the lock at ${lockPath}.`,
    );
  }

  const startedAt = new Date().toISOString();
  const journal = (
    status: JournalEntry["status"],
    applied: readonly Operation[],
    rollbackErrors: readonly string[],
    finished: boolean,
  ): void => {
    if (env.stateRoot === undefined) return;
    writeJournalEntry(env.stateRoot, {
      planId: plan.id,
      status,
      operations: plan.operations,
      applied,
      rollbackErrors,
      startedAt,
      ...(finished ? { finishedAt: new Date().toISOString() } : {}),
    });
  };

  const applied: Operation[] = [];
  try {
    journal("in-progress", applied, [], false);
    for (const operation of plan.operations) {
      const error =
        executeOperation(operation, env) ?? verifyOperation(operation);
      if (error !== null) {
        const rollbackErrors: string[] = [];
        for (const done of [...applied].reverse()) {
          const inverse = invertOperation(done);
          if (inverse === null) {
            rollbackErrors.push(
              `No inverse exists for applied operation "${done.kind}".`,
            );
            continue;
          }
          const rollbackError = executeOperation(inverse, env);
          if (rollbackError !== null) rollbackErrors.push(rollbackError);
        }
        journal(
          rollbackErrors.length > 0 ? "rollback-failed" : "rolled-back",
          applied,
          rollbackErrors,
          true,
        );
        return failed(
          "transaction/operation-failed",
          `Operation "${operation.kind}" failed: ${error}`,
          {
            planId: plan.id,
            applied,
            rolledBack: true,
            rollbackErrors,
          },
        );
      }
      applied.push(operation);
      journal("in-progress", applied, [], false);
    }

    journal("applied", applied, [], true);
    return {
      ok: true,
      record: {
        planId: plan.id,
        applied,
        rolledBack: false,
        rollbackErrors: [],
      },
    };
  } finally {
    fs.closeSync(lockFd);
    fs.rmSync(lockPath, { force: true });
  }
}
