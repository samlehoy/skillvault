import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashDirectory } from "./hash.js";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-hash-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const write = (dir: string, rel: string, content: string) => {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
};

describe("hashDirectory", () => {
  it("returns a sha256-prefixed hash", () => {
    const dir = path.join(root, "a");
    write(dir, "SKILL.md", "hello");
    const result = hashDirectory(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("is identical for identical content regardless of creation order", () => {
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    write(a, "SKILL.md", "root");
    write(a, "references/x.md", "x");
    write(a, "scripts/run.js", "js");
    write(b, "scripts/run.js", "js");
    write(b, "references/x.md", "x");
    write(b, "SKILL.md", "root");

    const ha = hashDirectory(a);
    const hb = hashDirectory(b);
    expect(ha.ok && hb.ok && ha.hash === hb.hash).toBe(true);
  });

  it("changes when file content changes", () => {
    const a = path.join(root, "a");
    write(a, "SKILL.md", "one");
    const before = hashDirectory(a);
    write(a, "SKILL.md", "two");
    const after = hashDirectory(a);
    expect(before.ok && after.ok && before.hash !== after.hash).toBe(true);
  });

  it("changes when a file is renamed even with identical content", () => {
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    write(a, "one.md", "same");
    write(b, "two.md", "same");
    const ha = hashDirectory(a);
    const hb = hashDirectory(b);
    expect(ha.ok && hb.ok && ha.hash !== hb.hash).toBe(true);
  });

  it("does not depend on the directory's own name or location", () => {
    const a = path.join(root, "deep", "nested", "a");
    const b = path.join(root, "b");
    write(a, "SKILL.md", "same");
    write(b, "SKILL.md", "same");
    const ha = hashDirectory(a);
    const hb = hashDirectory(b);
    expect(ha.ok && hb.ok && ha.hash === hb.hash).toBe(true);
  });

  it("hashes an empty directory deterministically", () => {
    const a = path.join(root, "a");
    const b = path.join(root, "b");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    const ha = hashDirectory(a);
    const hb = hashDirectory(b);
    expect(ha.ok && hb.ok && ha.hash === hb.hash).toBe(true);
  });

  it("fails with a structured error for a missing directory", () => {
    const result = hashDirectory(path.join(root, "ghost"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("hash/not-a-directory");
  });

  it("fails for a file path", () => {
    const file = path.join(root, "f.txt");
    fs.writeFileSync(file, "x");
    const result = hashDirectory(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("hash/not-a-directory");
  });
});
