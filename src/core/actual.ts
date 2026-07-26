import type { OwnershipClass } from "./ownership.js";

/**
 * Actual-state model: what discovery observes inside real agent IDE
 * installations, expressed as pure data (ARCHITECTURE.md, "Inventory and
 * discovery" and "Audit engine"). No filesystem access happens here; adapters
 * produce these values in later milestones.
 *
 * Link states mirror the audit categories for link health: healthy links,
 * missing or broken or redirected links, native content diverging from the
 * resolved content, and unmanaged content found inside a managed target.
 */

export const AGENTS = ["opencode", "antigravity", "claude-code", "codex"] as const;

export type Agent = (typeof AGENTS)[number];

export const LINK_STATES = [
  "linked",
  "missing",
  "broken",
  "redirected",
  "divergent",
  "unmanaged",
] as const;

export type LinkState = (typeof LINK_STATES)[number];

export interface ActualInstallation {
  readonly id: string;
  readonly agent: Agent;
  readonly scope: "global" | "project";
  readonly root: string;
}

export interface ActualTarget {
  readonly installationId: string;
  /** Canonical skill ID when the content maps to a managed skill. */
  readonly skillId: string | undefined;
  readonly path: string;
  readonly linkState: LinkState;
  readonly ownership: OwnershipClass;
}

export interface ActualState {
  readonly installations: readonly ActualInstallation[];
  readonly targets: readonly ActualTarget[];
}

const byInstallationThenPath = (a: ActualTarget, b: ActualTarget) =>
  a.installationId.localeCompare(b.installationId) ||
  a.path.localeCompare(b.path);

export function targetsForSkill(
  state: ActualState,
  skillId: string,
): readonly ActualTarget[] {
  return state.targets
    .filter((target) => target.skillId === skillId)
    .sort(byInstallationThenPath);
}

export function summarizeLinkStates(
  state: ActualState,
): Partial<Record<LinkState, number>> {
  const summary: Partial<Record<LinkState, number>> = {};
  for (const linkState of LINK_STATES) {
    const count = state.targets.filter(
      (target) => target.linkState === linkState,
    ).length;
    if (count > 0) summary[linkState] = count;
  }
  return summary;
}
