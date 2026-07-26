import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { hashDirectory } from "../fs/hash.js";
import { runGit } from "./run.js";

/**
 * Git source resolution and reproducible synchronization (Milestone 4).
 *
 * Every repository gets one bare mirror clone under the cache root
 * (`~/.skillvault/cache/git/` in production; injected here). Resolving a
 * source fetches and pins a ref to a commit SHA plus a normalized content
 * hash; synchronizing a *locked* entry materializes exactly that commit —
 * offline when the cache already holds it — and fails closed on any
 * mismatch. Update checks are read-only: they never touch a lockfile.
 */

export interface GitError {
  readonly code:
    | "git/not-found"
    | "git/failed"
    | "git/remote-unavailable"
    | "git/ref-not-found"
    | "git/commit-missing"
    | "git/subdir-missing"
    | "git/content-mismatch"
    | "git/io-error";
  readonly message: string;
}

export interface GitSourceRequest {
  readonly repository: string;
  readonly ref?: string;
  readonly subdir?: string;
}

export interface LockedGitSource {
  readonly repository: string;
  readonly subdir?: string;
  readonly commit: string;
  readonly contentHash: string;
}

export interface CacheOptions {
  readonly cacheRoot: string;
}

export interface MaterializeOptions extends CacheOptions {
  /** Destination directory for the exported tree; created, must not exist. */
  readonly exportDir: string;
}

export type ResolveResult =
  | {
      readonly ok: true;
      readonly commit: string;
      readonly contentHash: string;
      readonly exportDir: string;
    }
  | { readonly ok: false; readonly error: GitError };

export type SyncResult =
  | {
      readonly ok: true;
      readonly commit: string;
      readonly contentHash: string;
      readonly exportDir: string;
      /** True when the cache satisfied the sync without contacting the remote. */
      readonly offline: boolean;
    }
  | { readonly ok: false; readonly error: GitError };

export type UpdateCheck =
  | { readonly ok: true; readonly current: true; readonly commit: string }
  | {
      readonly ok: true;
      readonly current: false;
      readonly oldCommit: string;
      readonly newCommit: string;
      readonly changedFiles: readonly { status: string; path: string }[];
    }
  | { readonly ok: false; readonly error: GitError };

const fail = (code: GitError["code"], message: string) =>
  ({ ok: false, error: { code, message } }) as const;

export function cacheDirFor(repository: string, cacheRoot: string): string {
  const digest = crypto
    .createHash("sha256")
    .update(repository)
    .digest("hex")
    .slice(0, 12);
  const trimmed = repository.replace(/\/+$/, "").replace(/\.git$/, "");
  const last = trimmed.split(/[\\/:]+/).filter(Boolean).pop() ?? "repo";
  const slug =
    last.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 40) || "repo";
  return path.join(cacheRoot, `${slug}-${digest}`);
}

const mirrorExists = (cacheDir: string): boolean =>
  fs.existsSync(path.join(cacheDir, "config"));

type MirrorResult =
  | { readonly ok: true; readonly cacheDir: string; readonly cloned: boolean }
  | { readonly ok: false; readonly error: GitError };

function ensureMirror(repository: string, cacheRoot: string): MirrorResult {
  const cacheDir = cacheDirFor(repository, cacheRoot);
  if (mirrorExists(cacheDir)) return { ok: true, cacheDir, cloned: false };

  fs.mkdirSync(cacheRoot, { recursive: true });
  const clone = runGit(["clone", "--mirror", repository, cacheDir]);
  if (!clone.ok) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    if (clone.error.code === "git/not-found") return { ok: false, error: clone.error };
    return fail(
      "git/remote-unavailable",
      `Could not clone ${repository}: ${clone.error.message}`,
    );
  }
  return { ok: true, cacheDir, cloned: true };
}

function fetchMirror(cacheDir: string, repository: string): GitError | undefined {
  const fetch = runGit(["fetch", "--prune", "origin"], { cwd: cacheDir });
  if (!fetch.ok) {
    return {
      code: "git/remote-unavailable",
      message: `Could not fetch ${repository}: ${fetch.error.message}`,
    };
  }
  return undefined;
}

function resolveCommit(
  cacheDir: string,
  ref: string,
): { readonly ok: true; readonly commit: string } | { readonly ok: false; readonly error: GitError } {
  const parsed = runGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
    cwd: cacheDir,
  });
  if (!parsed.ok) {
    return fail(
      "git/ref-not-found",
      `Ref "${ref}" does not resolve to a commit in the cached repository.`,
    );
  }
  return { ok: true, commit: parsed.stdout.trim() };
}

const hasCommit = (cacheDir: string, commit: string): boolean =>
  runGit(["cat-file", "-e", `${commit}^{commit}`], { cwd: cacheDir }).ok;

/**
 * Exports `commit` (optionally narrowed to `subdir`) from the mirror into
 * `exportDir` via a transient detached worktree, and content-hashes the
 * result. The worktree lives inside the cache directory and is always
 * removed, success or failure.
 */
function materializeCommit(
  cacheDir: string,
  commit: string,
  subdir: string | undefined,
  exportDir: string,
):
  | { readonly ok: true; readonly contentHash: string }
  | { readonly ok: false; readonly error: GitError } {
  const worktreeDir = path.join(
    cacheDir,
    `.sv-worktree-${commit.slice(0, 12)}-${process.pid}`,
  );
  const added = runGit(["worktree", "add", "--detach", worktreeDir, commit], {
    cwd: cacheDir,
  });
  if (!added.ok) {
    return fail(
      "git/commit-missing",
      `Commit ${commit} could not be checked out from the cache: ${added.error.message}`,
    );
  }

  try {
    const sourceDir =
      subdir === undefined
        ? worktreeDir
        : path.join(worktreeDir, ...subdir.split("/"));
    let sourceStats: fs.Stats | undefined;
    try {
      sourceStats = fs.statSync(sourceDir);
    } catch {
      sourceStats = undefined;
    }
    if (subdir !== undefined && (sourceStats === undefined || !sourceStats.isDirectory())) {
      return fail(
        "git/subdir-missing",
        `Subdirectory "${subdir}" does not exist in commit ${commit}.`,
      );
    }

    try {
      fs.mkdirSync(path.dirname(exportDir), { recursive: true });
      fs.cpSync(sourceDir, exportDir, {
        recursive: true,
        filter: (src) =>
          !(path.dirname(src) === worktreeDir && path.basename(src) === ".git") &&
          path.basename(src) !== ".git",
      });
    } catch (error) {
      fs.rmSync(exportDir, { recursive: true, force: true });
      return fail(
        "git/io-error",
        `Failed to export ${commit} to ${exportDir}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const hashed = hashDirectory(exportDir);
    if (!hashed.ok) return fail("git/io-error", hashed.error.message);
    return { ok: true, contentHash: hashed.hash };
  } finally {
    const removed = runGit(["worktree", "remove", "--force", worktreeDir], {
      cwd: cacheDir,
    });
    if (!removed.ok) {
      fs.rmSync(worktreeDir, { recursive: true, force: true });
      runGit(["worktree", "prune"], { cwd: cacheDir });
    }
  }
}

/**
 * Network-using resolution: fetch (or clone) the mirror, pin `ref` (default:
 * the remote default branch) to a commit, and export its content. This is
 * the operation that *creates* lock data; it never writes a lockfile itself.
 */
export function resolveGitSource(
  request: GitSourceRequest,
  options: MaterializeOptions,
): ResolveResult {
  const mirror = ensureMirror(request.repository, options.cacheRoot);
  if (!mirror.ok) return mirror;
  if (!mirror.cloned) {
    const fetchError = fetchMirror(mirror.cacheDir, request.repository);
    if (fetchError) return { ok: false, error: fetchError };
  }

  const resolved = resolveCommit(mirror.cacheDir, request.ref ?? "HEAD");
  if (!resolved.ok) return resolved;

  const materialized = materializeCommit(
    mirror.cacheDir,
    resolved.commit,
    request.subdir,
    options.exportDir,
  );
  if (!materialized.ok) return materialized;
  return {
    ok: true,
    commit: resolved.commit,
    contentHash: materialized.contentHash,
    exportDir: options.exportDir,
  };
}

/**
 * Reproducible synchronization of a locked entry: installs exactly
 * `entry.commit`, offline whenever the cache already holds it. A moving
 * branch never changes the output; a content-hash mismatch fails closed.
 */
export function syncLockedGitSource(
  entry: LockedGitSource,
  options: MaterializeOptions,
): SyncResult {
  const cacheDir = cacheDirFor(entry.repository, options.cacheRoot);
  let offline = true;

  if (!mirrorExists(cacheDir) || !hasCommit(cacheDir, entry.commit)) {
    offline = false;
    const mirror = ensureMirror(entry.repository, options.cacheRoot);
    if (!mirror.ok) return mirror;
    if (!mirror.cloned) {
      const fetchError = fetchMirror(cacheDir, entry.repository);
      if (fetchError) return { ok: false, error: fetchError };
    }
    if (!hasCommit(cacheDir, entry.commit)) {
      return fail(
        "git/commit-missing",
        `Locked commit ${entry.commit} does not exist in ${entry.repository} (rewritten history?).`,
      );
    }
  }

  const materialized = materializeCommit(
    cacheDir,
    entry.commit,
    entry.subdir,
    options.exportDir,
  );
  if (!materialized.ok) return materialized;

  if (materialized.contentHash !== entry.contentHash) {
    fs.rmSync(options.exportDir, { recursive: true, force: true });
    return fail(
      "git/content-mismatch",
      `Materialized content of ${entry.commit} hashes to ${materialized.contentHash}, but the lock records ${entry.contentHash}. Refusing to install unverified content.`,
    );
  }
  return {
    ok: true,
    commit: entry.commit,
    contentHash: materialized.contentHash,
    exportDir: options.exportDir,
    offline,
  };
}

/**
 * Read-only update check: fetches, resolves the ref, and reports old/new
 * commit plus the files changed under the source's scope. Never mutates any
 * lockfile, and an unreachable remote is an error — not "current".
 */
export function checkGitUpdate(
  entry: Omit<LockedGitSource, "contentHash"> & { readonly ref?: string },
  options: CacheOptions,
): UpdateCheck {
  const mirror = ensureMirror(entry.repository, options.cacheRoot);
  if (!mirror.ok) return mirror;
  if (!mirror.cloned) {
    const fetchError = fetchMirror(mirror.cacheDir, entry.repository);
    if (fetchError) return { ok: false, error: fetchError };
  }

  const resolved = resolveCommit(mirror.cacheDir, entry.ref ?? "HEAD");
  if (!resolved.ok) return resolved;
  if (resolved.commit === entry.commit) {
    return { ok: true, current: true, commit: entry.commit };
  }

  const diffArgs = [
    "diff",
    "--name-status",
    entry.commit,
    resolved.commit,
    ...(entry.subdir !== undefined ? ["--", entry.subdir] : []),
  ];
  const diff = runGit(diffArgs, { cwd: mirror.cacheDir });
  if (!diff.ok) {
    return fail(
      "git/failed",
      `Could not diff ${entry.commit}..${resolved.commit}: ${diff.error.message}`,
    );
  }
  const changedFiles = diff.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const parts = line.split("\t");
      return {
        status: (parts[0] ?? "?").charAt(0),
        path: parts[parts.length - 1] ?? "",
      };
    });
  return {
    ok: true,
    current: false,
    oldCommit: entry.commit,
    newCommit: resolved.commit,
    changedFiles,
  };
}
