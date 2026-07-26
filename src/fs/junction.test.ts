import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJunction, inspectPath, removeJunction } from "./junction.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-junction-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const makeSkillDir = (name: string): string => {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "# skill\n");
  return dir;
};

describe("inspectPath", () => {
  it("reports missing paths", () => {
    expect(inspectPath(path.join(root, "nope"))).toEqual({ kind: "missing" });
  });

  it("reports real directories", () => {
    expect(inspectPath(makeSkillDir("real"))).toEqual({ kind: "directory" });
  });

  it("reports files", () => {
    const file = path.join(root, "f.txt");
    fs.writeFileSync(file, "x");
    expect(inspectPath(file)).toEqual({ kind: "file" });
  });

  it("reports a live junction with its resolved target", () => {
    const target = makeSkillDir("target");
    const link = path.join(root, "link");
    const created = createJunction(target, link);
    expect(created.ok).toBe(true);

    const inspection = inspectPath(link);
    expect(inspection.kind).toBe("junction");
    if (inspection.kind === "junction") {
      expect(path.resolve(inspection.target)).toBe(path.resolve(target));
      expect(inspection.targetExists).toBe(true);
    }
  });

  it("reports a dangling junction after its target disappears", () => {
    const target = makeSkillDir("target");
    const link = path.join(root, "link");
    createJunction(target, link);
    fs.rmSync(target, { recursive: true, force: true });

    const inspection = inspectPath(link);
    expect(inspection.kind).toBe("junction");
    if (inspection.kind === "junction") {
      expect(inspection.targetExists).toBe(false);
    }
  });
});

describe("createJunction", () => {
  it("creates a junction readable through the link", () => {
    const target = makeSkillDir("target");
    const link = path.join(root, "agent", "my-skill");

    const result = createJunction(target, link);
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(link, "SKILL.md"), "utf8")).toContain(
      "# skill",
    );
  });

  it("creates missing parent directories for the link", () => {
    const target = makeSkillDir("target");
    const link = path.join(root, "a", "b", "c", "skill");
    expect(createJunction(target, link).ok).toBe(true);
    expect(inspectPath(link).kind).toBe("junction");
  });

  it("resolves relative targets to absolute before linking", () => {
    const target = makeSkillDir("target");
    const link = path.join(root, "link");
    const relative = path.relative(process.cwd(), target);

    const result = createJunction(relative, link);
    expect(result.ok).toBe(true);
    const inspection = inspectPath(link);
    if (inspection.kind === "junction") {
      expect(path.isAbsolute(inspection.target)).toBe(true);
      expect(path.resolve(inspection.target)).toBe(path.resolve(target));
    }
  });

  it("refuses when the target does not exist", () => {
    const result = createJunction(path.join(root, "ghost"), path.join(root, "l"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("junction/target-missing");
  });

  it("refuses when the target is a file, not a directory", () => {
    const file = path.join(root, "f.txt");
    fs.writeFileSync(file, "x");
    const result = createJunction(file, path.join(root, "l"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("junction/target-not-directory");
  });

  it("refuses when something already exists at the link path", () => {
    const target = makeSkillDir("target");
    const occupied = makeSkillDir("occupied");
    const result = createJunction(target, occupied);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("junction/link-exists");
  });
});

describe("removeJunction", () => {
  it("removes a junction without touching target content", () => {
    const target = makeSkillDir("target");
    const link = path.join(root, "link");
    createJunction(target, link);

    const result = removeJunction(link);
    expect(result.ok).toBe(true);
    expect(inspectPath(link)).toEqual({ kind: "missing" });
    expect(fs.existsSync(path.join(target, "SKILL.md"))).toBe(true);
  });

  it("removes a dangling junction", () => {
    const target = makeSkillDir("target");
    const link = path.join(root, "link");
    createJunction(target, link);
    fs.rmSync(target, { recursive: true, force: true });

    expect(removeJunction(link).ok).toBe(true);
    expect(inspectPath(link)).toEqual({ kind: "missing" });
  });

  it("refuses to remove a real directory (the critical safety property)", () => {
    const real = makeSkillDir("real");
    const result = removeJunction(real);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("junction/not-a-link");
    expect(fs.existsSync(path.join(real, "SKILL.md"))).toBe(true);
  });

  it("reports a missing path instead of silently succeeding", () => {
    const result = removeJunction(path.join(root, "nope"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("junction/missing");
  });
});
