import fs from "node:fs";
import path from "node:path";
import { inspectPath } from "../fs/junction.js";

/**
 * OpenCode reference adapter — read-only discovery.
 *
 * Paths follow the facts verified in docs/adapters/M0_VERIFIED_FACTS.md:
 * global skills live under `~/.config/opencode/skill{,s}/`, project skills
 * under `<project>/.opencode/skill{,s}/`, and OpenCode natively also reads
 * external `.claude/skills/` and `.agents/skills/` directories at both
 * roots. Discovery only reports top-level skill directories; it never
 * mutates the filesystem.
 */

export interface OpenCodeEnvironment {
  readonly homeDir: string;
  readonly projectDir?: string;
}

export interface OpenCodeInstallation {
  readonly adapterId: "opencode";
  readonly configRoot: string;
  readonly present: boolean;
}

export type SkillLocation = "opencode" | "claude-external" | "agents-external";

export interface DiscoveredSkill {
  readonly id: string;
  readonly path: string;
  readonly scope: "global" | "project";
  readonly location: SkillLocation;
  readonly entryKind: "directory" | "junction";
  readonly junctionTarget?: string;
  readonly dangling: boolean;
  readonly hasSkillMd: boolean;
}

export function discoverInstallation(
  env: OpenCodeEnvironment,
): OpenCodeInstallation {
  const configRoot = path.join(env.homeDir, ".config", "opencode");
  return {
    adapterId: "opencode",
    configRoot,
    present: inspectPath(configRoot).kind !== "missing",
  };
}

interface SearchRoot {
  readonly dir: string;
  readonly scope: "global" | "project";
  readonly location: SkillLocation;
}

function searchRoots(env: OpenCodeEnvironment): SearchRoot[] {
  const roots: SearchRoot[] = [];
  const add = (
    base: string,
    scope: "global" | "project",
  ): void => {
    roots.push(
      { dir: path.join(base, ".config", "opencode", "skill"), scope, location: "opencode" },
      { dir: path.join(base, ".config", "opencode", "skills"), scope, location: "opencode" },
      { dir: path.join(base, ".claude", "skills"), scope, location: "claude-external" },
      { dir: path.join(base, ".agents", "skills"), scope, location: "agents-external" },
    );
  };

  add(env.homeDir, "global");
  if (env.projectDir !== undefined) {
    roots.push(
      { dir: path.join(env.projectDir, ".opencode", "skill"), scope: "project", location: "opencode" },
      { dir: path.join(env.projectDir, ".opencode", "skills"), scope: "project", location: "opencode" },
      { dir: path.join(env.projectDir, ".claude", "skills"), scope: "project", location: "claude-external" },
      { dir: path.join(env.projectDir, ".agents", "skills"), scope: "project", location: "agents-external" },
    );
  }
  return roots;
}

const LOCATION_ORDER: Record<SkillLocation, number> = {
  opencode: 0,
  "claude-external": 1,
  "agents-external": 2,
};

export function discoverSkills(env: OpenCodeEnvironment): DiscoveredSkill[] {
  const found: DiscoveredSkill[] = [];

  for (const root of searchRoots(env)) {
    if (inspectPath(root.dir).kind !== "directory") continue;

    for (const entry of fs.readdirSync(root.dir, { withFileTypes: true })) {
      const entryPath = path.join(root.dir, entry.name);
      const inspection = inspectPath(entryPath);
      if (inspection.kind === "file" || inspection.kind === "missing") continue;

      const isJunction = inspection.kind === "junction";
      const dangling = isJunction && !inspection.targetExists;
      const hasSkillMd =
        !dangling && fs.existsSync(path.join(entryPath, "SKILL.md"));

      found.push({
        id: entry.name,
        path: entryPath,
        scope: root.scope,
        location: root.location,
        entryKind: isJunction ? "junction" : "directory",
        ...(isJunction ? { junctionTarget: inspection.target } : {}),
        dangling,
        hasSkillMd,
      });
    }
  }

  return found.sort(
    (a, b) =>
      a.scope.localeCompare(b.scope) ||
      LOCATION_ORDER[a.location] - LOCATION_ORDER[b.location] ||
      a.id.localeCompare(b.id) ||
      a.path.localeCompare(b.path),
  );
}
