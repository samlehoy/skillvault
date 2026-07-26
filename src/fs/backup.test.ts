import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackup } from "./backup.js";
import { hashDirectory } from "./hash.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-backup-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const makeSkill = (name: string): string => {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "# skill\n");
  fs.writeFileSync(path.join(dir, "references", "notes.md"), "notes\n");
  return dir;
};

describe("createBackup", () => {
  it("copies the tree and returns a verified content hash", () => {
    const source = makeSkill("source");
    const dest = path.join(root, "backups", "source.bak");

    const result = createBackup(source, dest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contentHash).toMatch(/^sha256:/);
      const sourceHash = hashDirectory(source);
      expect(sourceHash.ok && sourceHash.hash).toBe(result.contentHash);
    }
    expect(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8")).toContain(
      "# skill",
    );
    expect(
      fs.readFileSync(path.join(dest, "references", "notes.md"), "utf8"),
    ).toContain("notes");
  });

  it("leaves the source untouched", () => {
    const source = makeSkill("source");
    const before = hashDirectory(source);
    createBackup(source, path.join(root, "b"));
    const after = hashDirectory(source);
    expect(before.ok && after.ok && before.hash === after.hash).toBe(true);
  });

  it("creates missing parent directories for the destination", () => {
    const source = makeSkill("source");
    const dest = path.join(root, "deep", "nested", "bak");
    expect(createBackup(source, dest).ok).toBe(true);
  });

  it("refuses when the source does not exist", () => {
    const result = createBackup(path.join(root, "ghost"), path.join(root, "b"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("backup/source-missing");
  });

  it("refuses when the destination already exists (a backup is never overwritten)", () => {
    const source = makeSkill("source");
    const dest = makeSkill("existing");
    const destHashBefore = hashDirectory(dest);

    const result = createBackup(source, dest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("backup/dest-exists");

    const destHashAfter = hashDirectory(dest);
    expect(
      destHashBefore.ok && destHashAfter.ok &&
        destHashBefore.hash === destHashAfter.hash,
    ).toBe(true);
  });
});
