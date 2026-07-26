/**
 * Shared adapter discovery types. Every adapter reports skills in this
 * shape so the facade, audit, and contract tests treat adapters uniformly.
 */

export type LocationKey =
  | "opencode"
  | "antigravity"
  | "antigravity-ide"
  | "claude-external"
  | "agents-external";

/** Canonical display/iteration order for targets across the product. */
export const LOCATION_KEYS_ORDERED: readonly LocationKey[] = [
  "opencode",
  "antigravity",
  "antigravity-ide",
  "claude-external",
  "agents-external",
];

export interface DiscoveredSkill {
  readonly id: string;
  readonly path: string;
  readonly scope: "global" | "project";
  readonly location: LocationKey;
  readonly entryKind: "directory" | "junction";
  readonly junctionTarget?: string;
  readonly dangling: boolean;
  readonly hasSkillMd: boolean;
}
