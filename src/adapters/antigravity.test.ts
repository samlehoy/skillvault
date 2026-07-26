import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJunction } from "../fs/junction.js";
import { discoverInstallations, discoverSkills } from "./antigravity.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-av-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const makeSkill = (variantDir: string, id: string): string => {
  const dir = path.join(home, ".gemini", variantDir, "skills", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${id}\ndescription: d\n---\nbody\n`,
  );
  return dir;
};

describe("discoverInstallations", () => {
  it("reports both variants as absent when nothing exists", () => {
    const installations = discoverInstallations({ homeDir: home });
    expect(installations.map((i) => `${i.variant}:${i.present}`)).toEqual([
      "antigravity:false",
      "antigravity-ide:false",
    ]);
  });

  it("detects each variant independently", () => {
    fs.mkdirSync(path.join(home, ".gemini", "antigravity-ide", "skills"), {
      recursive: true,
    });
    const installations = discoverInstallations({ homeDir: home });
    expect(installations.find((i) => i.variant === "antigravity")?.present).toBe(false);
    expect(installations.find((i) => i.variant === "antigravity-ide")?.present).toBe(true);
  });
});

describe("discoverSkills", () => {
  it("finds skills per variant with distinct location keys", () => {
    makeSkill("antigravity", "motion-design");
    makeSkill("antigravity-ide", "brainstorming");

    const found = discoverSkills({ homeDir: home });
    expect(found.map((s) => `${s.location}:${s.id}`)).toEqual([
      "antigravity:motion-design",
      "antigravity-ide:brainstorming",
    ]);
    expect(found.every((s) => s.scope === "global")).toBe(true);
    expect(found.every((s) => s.hasSkillMd)).toBe(true);
  });

  it("classifies junctions and flags dangling ones", () => {
    const store = makeSkill("antigravity", "src");
    const linkDir = path.join(home, ".gemini", "antigravity-ide", "skills");
    fs.mkdirSync(linkDir, { recursive: true });
    createJunction(store, path.join(linkDir, "linked"));
    const gone = path.join(home, "gone");
    fs.mkdirSync(gone);
    createJunction(gone, path.join(linkDir, "dangling"));
    fs.rmdirSync(gone);

    const found = discoverSkills({ homeDir: home });
    const linked = found.find((s) => s.id === "linked");
    expect(linked?.entryKind).toBe("junction");
    expect(linked?.dangling).toBe(false);
    expect(found.find((s) => s.id === "dangling")?.dangling).toBe(true);
  });

  it("is read-only and deterministic", () => {
    makeSkill("antigravity", "zeta");
    makeSkill("antigravity", "alpha");
    const a = discoverSkills({ homeDir: home });
    const b = discoverSkills({ homeDir: home });
    expect(a).toEqual(b);
    expect(a.map((s) => s.id)).toEqual(["alpha", "zeta"]);
    expect(
      fs.existsSync(path.join(home, ".gemini", "antigravity-ide")),
    ).toBe(false);
  });
});
