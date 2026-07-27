import fs from "node:fs";
import path from "node:path";
import { inspectPath } from "../fs/junction.js";
import type { DiscoveredSkill } from "./types.js";

/**
 * Whether Antigravity's skill loader has been live-verified to follow
 * directory junctions on this platform (M0 pending fact; the discovery
 * facts in docs/adapters/M0_VERIFIED_FACTS.md). Until a live IDE session
 * proves it — a junction-linked probe skill readable from inside
 * Antigravity — the adapter stays visibility-only and is never offered as
 * a creatable link target (IMPLEMENTATION_PLAN.md, M3).
 */
export const ANTIGRAVITY_JUNCTION_CONSUMPTION_VERIFIED = false;

/**
 * Antigravity adapter — read-only discovery.
 *
 * Facts per docs/adapters/M0_VERIFIED_FACTS.md: two installed variants keep
 * separate skill directories under `~/.gemini/` — `antigravity/skills/` and
 * `antigravity-ide/skills/` — which makes them two distinct installations
 * under the identity rule. Skill format matches the canonical SKILL.md
 * directory model. Junction consumption by Antigravity's loader is still
 * unverified live; until it is, this adapter stays discovery-only and the
 * facade must not offer Antigravity as a creatable link target.
 */

export interface AntigravityEnvironment {
  readonly homeDir: string;
}

export type AntigravityVariant = "antigravity" | "antigravity-ide";

export interface AntigravityInstallation {
  readonly adapterId: "antigravity";
  readonly variant: AntigravityVariant;
  readonly skillsRoot: string;
  readonly present: boolean;
}

const VARIANTS: readonly AntigravityVariant[] = [
  "antigravity",
  "antigravity-ide",
];

const skillsRootFor = (env: AntigravityEnvironment, variant: AntigravityVariant): string =>
  path.join(env.homeDir, ".gemini", variant, "skills");

export function discoverInstallations(
  env: AntigravityEnvironment,
): AntigravityInstallation[] {
  return VARIANTS.map((variant) => {
    const skillsRoot = skillsRootFor(env, variant);
    return {
      adapterId: "antigravity",
      variant,
      skillsRoot,
      present: inspectPath(skillsRoot).kind === "directory",
    };
  });
}

export function discoverSkills(env: AntigravityEnvironment): DiscoveredSkill[] {
  const found: DiscoveredSkill[] = [];

  for (const variant of VARIANTS) {
    const root = skillsRootFor(env, variant);
    if (inspectPath(root).kind !== "directory") continue;

    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const entryPath = path.join(root, entry.name);
      const inspection = inspectPath(entryPath);
      if (inspection.kind === "file" || inspection.kind === "missing") continue;

      const isJunction = inspection.kind === "junction";
      const dangling = isJunction && !inspection.targetExists;
      found.push({
        id: entry.name,
        path: entryPath,
        scope: "global",
        location: variant,
        entryKind: isJunction ? "junction" : "directory",
        ...(isJunction ? { junctionTarget: inspection.target } : {}),
        dangling,
        hasSkillMd:
          !dangling && fs.existsSync(path.join(entryPath, "SKILL.md")),
      });
    }
  }

  return found.sort(
    (a, b) =>
      VARIANTS.indexOf(a.location as AntigravityVariant) -
        VARIANTS.indexOf(b.location as AntigravityVariant) ||
      a.id.localeCompare(b.id) ||
      a.path.localeCompare(b.path),
  );
}
