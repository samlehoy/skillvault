import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashDirectory } from "../fs/hash.js";
import { ingestLocalSkill } from "./ingest.js";

let root: string;
let vaultRoot: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-ingest-"));
  vaultRoot = path.join(root, "vault");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const makeSkill = (name: string, body = "Do things.\n"): string => {
  const dir = path.join(root, "src", name);
  fs.mkdirSync(path.join(dir, "references"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: a skill\n---\n${body}`,
  );
  fs.writeFileSync(path.join(dir, "references", "extra.md"), "extra\n");
  return dir;
};

describe("ingestLocalSkill", () => {
  it("ingests a valid skill into an immutable revision path", () => {
    const source = makeSkill("web2md");
    const result = ingestLocalSkill({ sourceDir: source, vaultRoot });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.entry.id).toBe("web2md");
    expect(result.entry.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(result.entry.vaultPath.startsWith(path.join(vaultRoot, "web2md"))).toBe(true);
    expect(result.alreadyPresent).toBe(false);

    const revisionHash = hashDirectory(result.entry.vaultPath);
    expect(revisionHash.ok && revisionHash.hash).toBe(result.entry.contentHash);
    expect(
      fs.readFileSync(path.join(result.entry.vaultPath, "SKILL.md"), "utf8"),
    ).toContain("web2md");
  });

  it("derives the id from frontmatter and surfaces name/description", () => {
    const source = makeSkill("my-skill");
    const result = ingestLocalSkill({ sourceDir: source, vaultRoot });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.id).toBe("my-skill");
      expect(result.entry.description).toBe("a skill");
    }
  });

  it("lets an explicit id override frontmatter, reporting a mismatch finding", () => {
    const source = makeSkill("upstream-name");
    const result = ingestLocalSkill({
      sourceDir: source,
      vaultRoot,
      id: "local-name",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entry.id).toBe("local-name");
      expect(result.findings).toEqual([
        expect.objectContaining({ code: "skill-md/name-mismatch" }),
      ]);
    }
  });

  it("is idempotent for identical content", () => {
    const source = makeSkill("stable");
    const first = ingestLocalSkill({ sourceDir: source, vaultRoot });
    const second = ingestLocalSkill({ sourceDir: source, vaultRoot });

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.alreadyPresent).toBe(true);
      expect(second.entry.vaultPath).toBe(first.entry.vaultPath);
      const revisions = fs.readdirSync(path.join(vaultRoot, "stable"));
      expect(revisions).toHaveLength(1);
    }
  });

  it("stores changed content as a second immutable revision, retaining the first", () => {
    const source = makeSkill("evolving", "v1\n");
    const first = ingestLocalSkill({ sourceDir: source, vaultRoot });
    fs.writeFileSync(
      path.join(source, "SKILL.md"),
      "---\nname: evolving\ndescription: a skill\n---\nv2\n",
    );
    const second = ingestLocalSkill({ sourceDir: source, vaultRoot });

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.entry.vaultPath).not.toBe(first.entry.vaultPath);
      expect(fs.existsSync(first.entry.vaultPath)).toBe(true);
      const revisions = fs.readdirSync(path.join(vaultRoot, "evolving"));
      expect(revisions).toHaveLength(2);
    }
  });

  it("rejects a directory that is not a valid skill and leaves the vault untouched", () => {
    const dir = path.join(root, "src", "not-a-skill");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "README.md"), "no SKILL.md here");

    const result = ingestLocalSkill({ sourceDir: dir, vaultRoot });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("vault/invalid-skill");
      expect(result.error.causes.length).toBeGreaterThan(0);
    }
    expect(fs.existsSync(vaultRoot)).toBe(false);
  });

  it("rejects a missing source directory", () => {
    const result = ingestLocalSkill({
      sourceDir: path.join(root, "ghost"),
      vaultRoot,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("vault/source-missing");
  });

  it("leaves the source untouched", () => {
    const source = makeSkill("untouched");
    const before = hashDirectory(source);
    ingestLocalSkill({ sourceDir: source, vaultRoot });
    const after = hashDirectory(source);
    expect(before.ok && after.ok && before.hash === after.hash).toBe(true);
  });

  it("leaves no staging residue after success", () => {
    const source = makeSkill("clean");
    const result = ingestLocalSkill({ sourceDir: source, vaultRoot });
    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(vaultRoot, ".staging"))).toBe(false);
  });
});
