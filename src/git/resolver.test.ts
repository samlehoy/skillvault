import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashDirectory } from "../fs/hash.js";
import {
  cacheDirFor,
  checkGitUpdate,
  resolveGitSource,
  syncLockedGitSource,
} from "./resolver.js";
import { runGit } from "./run.js";

/**
 * M4 integration tests: local temporary Git repositories only — no network,
 * no developer configuration touched (IMPLEMENTATION_PLAN.md, Milestone 4).
 */

let root: string;
let remoteDir: string;
let cacheRoot: string;
let exportCounter = 0;

const freshExportDir = (): string =>
  path.join(root, "exports", `export-${exportCounter++}`);

const git = (args: readonly string[], cwd: string): string => {
  const result = runGit(args, { cwd });
  if (!result.ok) {
    throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
  }
  return result.stdout.trim();
};

const writeFileIn = (dir: string, rel: string, content: string): void => {
  const full = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
};

const commitAll = (repoDir: string, message: string): string => {
  git(["add", "-A"], repoDir);
  git(
    [
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "user.name=Test",
      "commit",
      "-m",
      message,
    ],
    repoDir,
  );
  return git(["rev-parse", "HEAD"], repoDir);
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-git-test-"));
  cacheRoot = path.join(root, "cache");
  remoteDir = path.join(root, "remote");
  fs.mkdirSync(remoteDir, { recursive: true });
  git(["init", "-b", "main"], remoteDir);
  writeFileIn(
    remoteDir,
    "skills/alpha/SKILL.md",
    "---\nname: alpha\ndescription: first\n---\n\nAlpha v1.\n",
  );
  writeFileIn(
    remoteDir,
    "skills/beta/SKILL.md",
    "---\nname: beta\ndescription: second\n---\n\nBeta v1.\n",
  );
  commitAll(remoteDir, "v1");
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("cacheDirFor", () => {
  it("derives a stable directory distinct per repository", () => {
    const a = cacheDirFor("https://github.com/obra/superpowers.git", cacheRoot);
    const b = cacheDirFor("https://github.com/obra/superpowers", cacheRoot);
    const c = cacheDirFor("https://github.com/other/superpowers.git", cacheRoot);
    expect(a).toBe(cacheDirFor("https://github.com/obra/superpowers.git", cacheRoot));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(path.dirname(a)).toBe(cacheRoot);
    expect(path.basename(a)).toMatch(/^superpowers-[0-9a-f]{12}$/);
  });
});

describe("resolveGitSource", () => {
  it("resolves the default branch head to a commit and exports the tree", () => {
    const exportDir = freshExportDir();
    const result = resolveGitSource(
      { repository: remoteDir },
      { cacheRoot, exportDir },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fs.existsSync(path.join(exportDir, "skills", "alpha", "SKILL.md"))).toBe(true);
    // The export is a plain tree: no .git directory or file leaks out.
    expect(fs.existsSync(path.join(exportDir, ".git"))).toBe(false);
    const rehash = hashDirectory(exportDir);
    expect(rehash.ok && rehash.hash).toBe(result.contentHash);
  });

  it("exports only the requested subdirectory", () => {
    const exportDir = freshExportDir();
    const result = resolveGitSource(
      { repository: remoteDir, subdir: "skills/alpha" },
      { cacheRoot, exportDir },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.readdirSync(exportDir)).toEqual(["SKILL.md"]);
    expect(fs.readFileSync(path.join(exportDir, "SKILL.md"), "utf8")).toContain(
      "Alpha v1.",
    );
  });

  it("fails explicitly for a missing subdirectory", () => {
    const result = resolveGitSource(
      { repository: remoteDir, subdir: "skills/nonexistent" },
      { cacheRoot, exportDir: freshExportDir() },
    );
    expect(!result.ok && result.error.code).toBe("git/subdir-missing");
  });

  it("fails explicitly for an unknown ref", () => {
    const result = resolveGitSource(
      { repository: remoteDir, ref: "no-such-branch" },
      { cacheRoot, exportDir: freshExportDir() },
    );
    expect(!result.ok && result.error.code).toBe("git/ref-not-found");
  });

  it("reports an unavailable remote as unavailable with an empty cache", () => {
    const result = resolveGitSource(
      { repository: path.join(root, "does-not-exist") },
      { cacheRoot: path.join(root, "cache-empty"), exportDir: freshExportDir() },
    );
    expect(!result.ok && result.error.code).toBe("git/remote-unavailable");
  });

  it("persists no credentials in the cache repository config", () => {
    resolveGitSource({ repository: remoteDir }, { cacheRoot, exportDir: freshExportDir() });
    const configPath = path.join(cacheDirFor(remoteDir, cacheRoot), "config");
    const config = fs.readFileSync(configPath, "utf8");
    expect(config).not.toMatch(/credential|authorization|password|token/i);
  });
});

describe("syncLockedGitSource and moving branches", () => {
  let lockedCommit: string;
  let lockedHash: string;

  beforeAll(() => {
    const resolved = resolveGitSource(
      { repository: remoteDir, subdir: "skills/alpha" },
      { cacheRoot, exportDir: freshExportDir() },
    );
    if (!resolved.ok) throw new Error(resolved.error.message);
    lockedCommit = resolved.commit;
    lockedHash = resolved.contentHash;

    // The branch moves after the lock was created.
    writeFileIn(
      remoteDir,
      "skills/alpha/SKILL.md",
      "---\nname: alpha\ndescription: first\n---\n\nAlpha v2 CHANGED.\n",
    );
    commitAll(remoteDir, "v2");
  });

  it("installs exactly the locked revision even after the branch moved", () => {
    const exportDir = freshExportDir();
    const result = syncLockedGitSource(
      {
        repository: remoteDir,
        subdir: "skills/alpha",
        commit: lockedCommit,
        contentHash: lockedHash,
      },
      { cacheRoot, exportDir },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contentHash).toBe(lockedHash);
    expect(fs.readFileSync(path.join(exportDir, "SKILL.md"), "utf8")).toContain(
      "Alpha v1.",
    );
    expect(fs.readFileSync(path.join(exportDir, "SKILL.md"), "utf8")).not.toContain(
      "CHANGED",
    );
  });

  it("synchronizes offline from the cache without touching the remote", () => {
    const hiddenRemote = `${remoteDir}-hidden`;
    fs.renameSync(remoteDir, hiddenRemote);
    try {
      const exportDir = freshExportDir();
      const result = syncLockedGitSource(
        {
          repository: remoteDir,
          subdir: "skills/alpha",
          commit: lockedCommit,
          contentHash: lockedHash,
        },
        { cacheRoot, exportDir },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.offline).toBe(true);
      expect(result.contentHash).toBe(lockedHash);
    } finally {
      fs.renameSync(hiddenRemote, remoteDir);
    }
  });

  it("fails closed when the cache misses the commit and the remote is unreachable", () => {
    const result = syncLockedGitSource(
      {
        repository: path.join(root, "gone-remote"),
        commit: "a".repeat(40),
        contentHash: "sha256:deadbeef",
      },
      { cacheRoot, exportDir: freshExportDir() },
    );
    expect(!result.ok && result.error.code).toBe("git/remote-unavailable");
  });

  it("fails closed when materialized content does not match the locked hash", () => {
    const result = syncLockedGitSource(
      {
        repository: remoteDir,
        subdir: "skills/alpha",
        commit: lockedCommit,
        contentHash: "sha256:0000000000000000",
      },
      { cacheRoot, exportDir: freshExportDir() },
    );
    expect(!result.ok && result.error.code).toBe("git/content-mismatch");
  });

  it("reproduces identical content from a completely fresh environment", () => {
    const freshCache = path.join(root, "cache-fresh");
    const exportDir = freshExportDir();
    const result = syncLockedGitSource(
      {
        repository: remoteDir,
        subdir: "skills/alpha",
        commit: lockedCommit,
        contentHash: lockedHash,
      },
      { cacheRoot: freshCache, exportDir },
    );
    expect(result.ok && result.contentHash).toBe(lockedHash);
  });
});

describe("checkGitUpdate", () => {
  it("reports old and new commits with changed files when the branch advanced", () => {
    const resolved = resolveGitSource(
      { repository: remoteDir, subdir: "skills/alpha" },
      { cacheRoot, exportDir: freshExportDir() },
    );
    if (!resolved.ok) throw new Error(resolved.error.message);

    writeFileIn(
      remoteDir,
      "skills/alpha/SKILL.md",
      "---\nname: alpha\ndescription: first\n---\n\nAlpha v3.\n",
    );
    const newCommit = commitAll(remoteDir, "v3");

    const check = checkGitUpdate(
      { repository: remoteDir, subdir: "skills/alpha", commit: resolved.commit },
      { cacheRoot },
    );
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.current).toBe(false);
    if (check.current) return;
    expect(check.oldCommit).toBe(resolved.commit);
    expect(check.newCommit).toBe(newCommit);
    expect(check.changedFiles).toEqual([
      { status: "M", path: "skills/alpha/SKILL.md" },
    ]);
  });

  it("reports current when the locked commit is the ref head", () => {
    const head = git(["rev-parse", "HEAD"], remoteDir);
    const check = checkGitUpdate(
      { repository: remoteDir, commit: head },
      { cacheRoot },
    );
    expect(check.ok && check.current).toBe(true);
  });

  it("never reports current when the remote is unavailable", () => {
    const hiddenRemote = `${remoteDir}-hidden`;
    fs.renameSync(remoteDir, hiddenRemote);
    try {
      const check = checkGitUpdate(
        { repository: remoteDir, commit: "b".repeat(40) },
        { cacheRoot },
      );
      expect(check.ok).toBe(false);
      if (check.ok) return;
      expect(check.error.code).toBe("git/remote-unavailable");
    } finally {
      fs.renameSync(hiddenRemote, remoteDir);
    }
  });

  it("only changes inside the subdirectory count as updates to that source", () => {
    const head = git(["rev-parse", "HEAD"], remoteDir);
    writeFileIn(
      remoteDir,
      "skills/beta/SKILL.md",
      "---\nname: beta\ndescription: second\n---\n\nBeta v2.\n",
    );
    commitAll(remoteDir, "beta-only change");

    const check = checkGitUpdate(
      { repository: remoteDir, subdir: "skills/alpha", commit: head },
      { cacheRoot },
    );
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    // The branch moved, but nothing under skills/alpha changed: the source
    // is reported as an update with zero changed files so the caller can
    // present "commit moved, content identical" honestly.
    expect(check.current).toBe(false);
    if (check.current) return;
    expect(check.changedFiles).toEqual([]);
  });
});
