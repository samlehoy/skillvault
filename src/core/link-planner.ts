import { createHash } from "node:crypto";
import type { PathInspection } from "../fs/junction.js";
import type { VaultEntry } from "../vault/ingest.js";
import type { OwnershipClass } from "./ownership.js";
import { createPlan, type Operation, type Plan, type Precondition } from "./plan.js";

/**
 * Pure planners for linking and unlinking one skill at one target path
 * (IMPLEMENTATION_PLAN.md, M2). Observed filesystem state is injected; the
 * planner never touches the filesystem, so identical observations always
 * yield identical plans (and identical content-derived plan IDs).
 *
 * The `backup` operation is an evacuation: content moves into backup storage
 * before the link takes its place, which is why its inverse (`restore`)
 * genuinely returns the previous state.
 */

export interface ObservedTarget {
  readonly path: string;
  readonly inspection: PathInspection;
  readonly ownership: OwnershipClass;
}

export interface PlanError {
  readonly code: "plan/unsupported-target" | "plan/not-managed";
  readonly path: string;
  readonly message: string;
}

export type PlanBuildResult =
  | { readonly ok: true; readonly plan: Plan; readonly noop: boolean }
  | { readonly ok: false; readonly error: PlanError };

export function encodeInspection(inspection: PathInspection): string {
  return inspection.kind === "junction"
    ? `junction:${inspection.target}:${inspection.targetExists}`
    : inspection.kind;
}

const backupIdFor = (installationId: string, targetPath: string): string =>
  "bak-" +
  createHash("sha256")
    .update(`${installationId}\0${targetPath}`)
    .digest("hex")
    .slice(0, 16);

const finishPlan = (
  preconditions: readonly Precondition[],
  operations: readonly Operation[],
  ownership: ObservedTarget,
  postConditions: readonly string[],
): PlanBuildResult => ({
  ok: true,
  plan: createPlan({
    preconditions,
    operations,
    ownership: operations.length === 0
      ? []
      : [{ path: ownership.path, ownership: ownership.ownership }],
    postConditions,
  }),
  noop: operations.length === 0,
});

export interface LinkRequest {
  readonly entry: VaultEntry;
  readonly installationId: string;
  readonly target: ObservedTarget;
}

export function planLinkSkill(request: LinkRequest): PlanBuildResult {
  const { entry, installationId, target } = request;
  const preconditions: Precondition[] = [
    { key: `inspect:${target.path}`, value: encodeInspection(target.inspection) },
    { key: `vault:${entry.id}`, value: entry.contentHash },
  ];
  const postConditions = [`junction ${target.path} -> ${entry.vaultPath}`];
  const linkCreate: Operation = {
    kind: "link-create",
    installationId,
    path: target.path,
    targetPath: entry.vaultPath,
  };

  switch (target.inspection.kind) {
    case "missing":
      return finishPlan(preconditions, [linkCreate], target, postConditions);
    case "directory":
      return finishPlan(
        preconditions,
        [
          {
            kind: "backup",
            sourcePath: target.path,
            backupId: backupIdFor(installationId, target.path),
          },
          linkCreate,
        ],
        target,
        postConditions,
      );
    case "junction": {
      if (target.inspection.target === entry.vaultPath) {
        return finishPlan(preconditions, [], target, postConditions);
      }
      return finishPlan(
        preconditions,
        [
          {
            kind: "link-remove",
            installationId,
            path: target.path,
            targetPath: target.inspection.target,
          },
          linkCreate,
        ],
        target,
        postConditions,
      );
    }
    case "file":
      return {
        ok: false,
        error: {
          code: "plan/unsupported-target",
          path: target.path,
          message: `A file occupies ${target.path}; linking a skill over a file is not supported.`,
        },
      };
  }
}

export interface UnlinkRequest {
  readonly installationId: string;
  readonly target: ObservedTarget;
}

export function planUnlinkSkill(request: UnlinkRequest): PlanBuildResult {
  const { installationId, target } = request;
  const preconditions: Precondition[] = [
    { key: `inspect:${target.path}`, value: encodeInspection(target.inspection) },
  ];
  const postConditions = [`missing ${target.path}`];

  switch (target.inspection.kind) {
    case "missing":
      return finishPlan(preconditions, [], target, postConditions);
    case "junction":
      return finishPlan(
        preconditions,
        [
          {
            kind: "link-remove",
            installationId,
            path: target.path,
            targetPath: target.inspection.target,
          },
        ],
        target,
        postConditions,
      );
    case "directory":
    case "file":
      return {
        ok: false,
        error: {
          code: "plan/not-managed",
          path: target.path,
          message: `${target.path} is a real ${target.inspection.kind}, not a managed link; removing it is an uninstall concern with backup, not an unlink.`,
        },
      };
  }
}
