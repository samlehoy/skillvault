import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJunction } from "../fs/junction.js";
import { discoverInstallation, discoverSkills } from "./opencode.js";

let home: string;
let project: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-oc-home-"));
  project = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-oc-proj-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(project, { recursive: true, force: true });
});

const makeSkill = (base: string, id: string, withSkillMd = true): string => {
  const dir = path.join(base, id);
  fs.mkdirSync(dir, { recursive: true });
  if (withSkillMd) fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: d\n---\nbody\n`);
  return dir;
};

describe("discoverInstallation", () => {
  it("reports an absent installation when the config root is missing", () => {
    const installation = discoverInstallation({ homeDir: home });
    expect(installation.present).toBe(false);
    expect(installation.adapterId).toBe("opencode");
    expect(installation.configRoot).toBe(
      path.join(home, ".config", "opencode"),
    );
  });

  it("reports a present installation when the config root exists", () => {
    fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true });
    expect(discoverInstallation({ homeDir: home }).present).toBe(true);
  });
});

describe("discoverSkills", () => {
  it("returns an empty list when nothing exists", () => {
    expect(discoverSkills({ homeDir: home })).toEqual([]);
  });

  it("finds global skills in both skill/ and skills/ directories", () => {
    makeSkill(path.join(home, ".config", "opencode", "skills"), "alpha");
    makeSkill(path.join(home, ".config", "opencode", "skill"), "beta");

    const found = discoverSkills({ homeDir: home });
    expect(found.map((s) => s.id)).toEqual(["alpha", "beta"]);
    expect(found.every((s) => s.scope === "global")).toBe(true);
    expect(found.every((s) => s.location === "opencode")).toBe(true);
  });

  it("finds global external skills in .claude/skills and .agents/skills", () => {
    makeSkill(path.join(home, ".claude", "skills"), "from-claude");
    makeSkill(path.join(home, ".agents", "skills"), "from-agents");

    const found = discoverSkills({ homeDir: home });
    expect(
      found.map((s) => `${s.location}:${s.id}`).sort(),
    ).toEqual(["agents-external:from-agents", "claude-external:from-claude"]);
  });

  it("finds project skills under .opencode and project external directories", () => {
    makeSkill(path.join(project, ".opencode", "skills"), "proj-skill");
    makeSkill(path.join(project, ".claude", "skills"), "proj-claude");

    const found = discoverSkills({ homeDir: home, projectDir: project });
    expect(found.map((s) => `${s.scope}:${s.location}:${s.id}`)).toEqual([
      "project:opencode:proj-skill",
      "project:claude-external:proj-claude",
    ]);
  });

  it("classifies junction entries and resolves their targets", () => {
    const store = makeSkill(path.join(home, "store"), "linked");
    const skillsDir = path.join(home, ".config", "opencode", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    createJunction(store, path.join(skillsDir, "linked"));

    const [skill] = discoverSkills({ homeDir: home });
    expect(skill?.entryKind).toBe("junction");
    expect(skill && "junctionTarget" in skill && skill.junctionTarget).toBe(
      store,
    );
    expect(skill?.dangling).toBe(false);
  });

  it("flags dangling junctions", () => {
    const store = makeSkill(path.join(home, "store"), "gone");
    const skillsDir = path.join(home, ".config", "opencode", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    createJunction(store, path.join(skillsDir, "gone"));
    fs.rmSync(store, { recursive: true, force: true });

    const [skill] = discoverSkills({ homeDir: home });
    expect(skill?.entryKind).toBe("junction");
    expect(skill?.dangling).toBe(true);
  });

  it("reports directories without SKILL.md as candidates with hasSkillMd false", () => {
    makeSkill(path.join(home, ".config", "opencode", "skills"), "no-md", false);
    const [skill] = discoverSkills({ homeDir: home });
    expect(skill?.hasSkillMd).toBe(false);
  });

  it("reports the same id in multiple locations as separate occurrences", () => {
    makeSkill(path.join(home, ".config", "opencode", "skills"), "dup");
    makeSkill(path.join(home, ".agents", "skills"), "dup");

    const found = discoverSkills({ homeDir: home });
    expect(found.filter((s) => s.id === "dup")).toHaveLength(2);
  });

  it("is deterministic and sorted regardless of filesystem enumeration order", () => {
    const base = path.join(home, ".config", "opencode", "skills");
    for (const id of ["zeta", "alpha", "mid"]) makeSkill(base, id);
    const a = discoverSkills({ homeDir: home });
    const b = discoverSkills({ homeDir: home });
    expect(a).toEqual(b);
    expect(a.map((s) => s.id)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("is read-only: discovery never creates directories", () => {
    discoverSkills({ homeDir: home, projectDir: project });
    expect(fs.existsSync(path.join(home, ".config"))).toBe(false);
    expect(fs.existsSync(path.join(project, ".opencode"))).toBe(false);
  });

  it("ignores plain files inside skills directories", () => {
    const base = path.join(home, ".config", "opencode", "skills");
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, "README.md"), "not a skill");
    expect(discoverSkills({ homeDir: home })).toEqual([]);
  });
});
