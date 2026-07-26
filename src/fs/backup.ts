import fs from "node:fs";
import path from "node:path";
import { hashDirectory } from "./hash.js";

/**
 * Verified directory backups (PRODUCT.md, "Safe mutation": back up unmanaged
 * content before replacement or deletion).
 *
 * A backup is copy-then-verify: the destination must not already exist (a
 * backup is never overwritten), and the copy is proven complete by comparing
 * content hashes before the operation reports success.
 */

export interface BackupError {
  readonly code:
    | "backup/source-missing"
    | "backup/dest-exists"
    | "backup/verify-failed"
    | "backup/io-error";
  readonly path: string;
  readonly message: string;
}

export type BackupResult =
  | { readonly ok: true; readonly contentHash: string }
  | { readonly ok: false; readonly error: BackupError };

const fail = (
  code: BackupError["code"],
  errPath: string,
  message: string,
): BackupResult => ({ ok: false, error: { code, path: errPath, message } });

export function createBackup(source: string, dest: string): BackupResult {
  const sourceHash = hashDirectory(source);
  if (!sourceHash.ok) {
    return fail(
      "backup/source-missing",
      source,
      `Backup source is not a readable directory: ${source}`,
    );
  }
  if (fs.existsSync(dest)) {
    return fail(
      "backup/dest-exists",
      dest,
      `Backup destination already exists and will not be overwritten: ${dest}`,
    );
  }

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(source, dest, { recursive: true });
  } catch (error) {
    return fail(
      "backup/io-error",
      dest,
      `Failed to copy backup: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const destHash = hashDirectory(dest);
  if (!destHash.ok || destHash.hash !== sourceHash.hash) {
    return fail(
      "backup/verify-failed",
      dest,
      `Backup verification failed: destination content does not match source.`,
    );
  }
  return { ok: true, contentHash: destHash.hash };
}
