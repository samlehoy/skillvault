import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Deterministic directory content hashing.
 *
 * One hash serves three needs: lockfile `contentHash` entries, backup
 * verification, and drift detection. The hash covers relative paths (posix
 * separators, sorted) and file bytes — not the directory's own name,
 * location, or timestamps — so identical content hashes identically on any
 * machine.
 */

export interface HashError {
  readonly code: "hash/not-a-directory" | "hash/io-error";
  readonly path: string;
  readonly message: string;
}

export type HashResult =
  | { readonly ok: true; readonly hash: string }
  | { readonly ok: false; readonly error: HashError };

function collectFiles(dir: string, prefix: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    // stat (not lstat): links inside a skill directory hash by the content
    // they resolve to, matching how agent IDEs read them.
    const stats = fs.statSync(full);
    if (stats.isDirectory()) collectFiles(full, rel, out);
    else out.push(rel);
  }
}

export function hashDirectory(dir: string): HashResult {
  let stats: fs.Stats;
  try {
    stats = fs.statSync(dir);
  } catch {
    return {
      ok: false,
      error: {
        code: "hash/not-a-directory",
        path: dir,
        message: `Cannot hash ${dir}: it does not exist.`,
      },
    };
  }
  if (!stats.isDirectory()) {
    return {
      ok: false,
      error: {
        code: "hash/not-a-directory",
        path: dir,
        message: `Cannot hash ${dir}: it is not a directory.`,
      },
    };
  }

  try {
    const files: string[] = [];
    collectFiles(dir, "", files);
    files.sort();

    const hash = crypto.createHash("sha256");
    for (const rel of files) {
      hash.update(rel);
      hash.update("\0");
      hash.update(fs.readFileSync(path.join(dir, ...rel.split("/"))));
      hash.update("\0");
    }
    return { ok: true, hash: `sha256:${hash.digest("hex")}` };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "hash/io-error",
        path: dir,
        message: `Failed to hash ${dir}: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
