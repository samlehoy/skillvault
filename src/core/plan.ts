import { createHash } from "node:crypto";
import type { Manifest, Lockfile } from "./manifest.js";
import {
  type OwnershipClass,
  requiresBackupBeforeMutation,
} from "./ownership.js";

/**
 * Immutable plan and operation models (ARCHITECTURE.md, "Planning" and
 * "Transactions and rollback"). A plan captures the preconditions it was
 * calculated from, the exact operations, ownership classification for every
 * affected path, derived backup requirements, and whether every operation
 * records an inverse. Applying a stale plan must be rejected; staleness is a
 * pure comparison of recorded preconditions against freshly observed facts.
 *
 * Plan IDs are content-derived (sha256 over a canonical JSON encoding) so the
 * same inputs always produce the same ID, regardless of object key order.
 */

export interface Precondition {
  readonly key: string;
  readonly value: string;
}

export type Operation =
  | {
      readonly kind: "manifest-write";
      readonly scope: "global" | "project";
      readonly before: Manifest | null;
      readonly after: Manifest;
    }
  | {
      readonly kind: "lockfile-write";
      readonly scope: "global" | "project";
      readonly before: Lockfile | null;
      readonly after: Lockfile;
    }
  | {
      readonly kind: "vault-stage";
      readonly skillId: string;
      readonly contentHash: string;
    }
  | {
      readonly kind: "vault-unstage";
      readonly skillId: string;
      readonly contentHash: string;
    }
  | {
      readonly kind: "link-create";
      readonly installationId: string;
      readonly path: string;
      readonly targetPath: string;
    }
  | {
      readonly kind: "link-remove";
      readonly installationId: string;
      readonly path: string;
      readonly targetPath: string;
    }
  | {
      readonly kind: "backup";
      readonly sourcePath: string;
      readonly backupId: string;
    }
  | {
      readonly kind: "restore";
      readonly backupId: string;
      readonly targetPath: string;
    };

/**
 * Returns the inverse operation where one exists, or null for operations
 * with a known rollback limitation (creating the first manifest/lockfile has
 * no prior document to write back; a restore consumes its backup).
 */
export function invertOperation(operation: Operation): Operation | null {
  switch (operation.kind) {
    case "manifest-write":
      if (operation.before === null) return null;
      return {
        kind: "manifest-write",
        scope: operation.scope,
        before: operation.after,
        after: operation.before,
      };
    case "lockfile-write":
      if (operation.before === null) return null;
      return {
        kind: "lockfile-write",
        scope: operation.scope,
        before: operation.after,
        after: operation.before,
      };
    case "vault-stage":
      return { ...operation, kind: "vault-unstage" };
    case "vault-unstage":
      return { ...operation, kind: "vault-stage" };
    case "link-create":
      return { ...operation, kind: "link-remove" };
    case "link-remove":
      return { ...operation, kind: "link-create" };
    case "backup":
      return {
        kind: "restore",
        backupId: operation.backupId,
        targetPath: operation.sourcePath,
      };
    case "restore":
      return null;
  }
}

export interface PathOwnership {
  readonly path: string;
  readonly ownership: OwnershipClass;
}

export interface PlanInput {
  readonly preconditions: readonly Precondition[];
  readonly operations: readonly Operation[];
  readonly ownership: readonly PathOwnership[];
  readonly postConditions: readonly string[];
}

export interface Plan extends PlanInput {
  readonly id: string;
  /** True when every operation records an inverse. */
  readonly reversible: boolean;
  /** Affected paths whose content must be backed up before mutation. */
  readonly backupRequired: readonly string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function createPlan(input: PlanInput): Plan {
  const id = createHash("sha256")
    .update(JSON.stringify(canonicalize(input)))
    .digest("hex");
  return {
    ...input,
    id: `plan-${id}`,
    reversible: input.operations.every(
      (operation) => invertOperation(operation) !== null,
    ),
    backupRequired: input.ownership
      .filter((entry) => requiresBackupBeforeMutation(entry.ownership))
      .map((entry) => entry.path)
      .sort((a, b) => a.localeCompare(b)),
  };
}

export function isPlanStale(
  plan: Plan,
  observed: readonly Precondition[],
): boolean {
  const facts = new Map(observed.map((fact) => [fact.key, fact.value]));
  return plan.preconditions.some(
    (precondition) => facts.get(precondition.key) !== precondition.value,
  );
}
