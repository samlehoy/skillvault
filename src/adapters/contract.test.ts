import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJunction } from "../fs/junction.js";
import * as antigravity from "./antigravity.js";
import * as opencode from "./opencode.js";
import type { DiscoveredSkill } from "./types.js";

/**
 * Shared adapter contract (IMPLEMENTATION_PLAN.md, M3): every adapter's
 * discovery must behave identically for the behaviors below, so the core
 * never needs adapter-specific special cases.
 */

interface AdapterCase {
  readonly name: string;
  readonly discover: (home: string) => DiscoveredSkill[];
  readonly skillsDir: (home: string) => string;
}

const CASES: readonly AdapterCase[] = [
  {
    name: "opencode",
    discover: (home) => opencode.discoverSkills({ homeDir: home }),
    skillsDir: (home) => path.join(home, ".config", "opencode", "skills"),
  },
  {
    name: "antigravity",
    discover: (home) => antigravity.discoverSkills({ homeDir: home }),
    skillsDir: (home) => path.join(home, ".gemini", "antigravity", "skills"),
  },
];

describe.each(CASES)("adapter contract: $name", ({ discover, skillsDir }) => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-contract-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const makeSkill = (id: string, withMd = true): string => {
    const dir = path.join(skillsDir(home), id);
    fs.mkdirSync(dir, { recursive: true });
    if (withMd) fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: x\ndescription: d\n---\nb\n");
    return dir;
  };

  it("returns an empty list when nothing exists, without creating directories", () => {
    expect(discover(home)).toEqual([]);
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it("is deterministic and sorted by id", () => {
    makeSkill("zeta");
    makeSkill("alpha");
    const a = discover(home);
    expect(a).toEqual(discover(home));
    expect(a.map((s) => s.id)).toEqual(["alpha", "zeta"]);
  });

  it("resolves junction targets and flags dangling links", () => {
    const target = makeSkill("target");
    createJunction(target, path.join(skillsDir(home), "linked"));
    const gone = path.join(home, "gone");
    fs.mkdirSync(gone);
    createJunction(gone, path.join(skillsDir(home), "dangling"));
    fs.rmdirSync(gone);

    const found = discover(home);
    const linked = found.find((s) => s.id === "linked");
    expect(linked?.entryKind).toBe("junction");
    expect(
      linked && "junctionTarget" in linked && path.resolve(linked.junctionTarget ?? ""),
    ).toBe(path.resolve(target));
    expect(linked?.dangling).toBe(false);
    expect(found.find((s) => s.id === "dangling")?.dangling).toBe(true);
  });

  it("ignores plain files and flags missing SKILL.md", () => {
    fs.mkdirSync(skillsDir(home), { recursive: true });
    fs.writeFileSync(path.join(skillsDir(home), "README.md"), "not a skill");
    makeSkill("no-md", false);

    const found = discover(home);
    expect(found).toHaveLength(1);
    expect(found[0]?.hasSkillMd).toBe(false);
  });
});
