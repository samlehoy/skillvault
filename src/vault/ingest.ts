import fs from "node:fs";
import path from "node:path";
import type { ParseError } from "../core/manifest.js";
import { checkIdAlignment, parseSkillMd } from "../core/skill-md.js";
import type { AlignmentFinding } from "../core/skill-md.js";
import { hashDirectory } from "../fs/hash.js";
import { inspectPath } from "../fs/junction.js";

/**
 * Vault ingestion for local skills (ARCHITECTURE.md, "Vault and Link Model").
 *
 * The vault stores immutable resolved revisions: `<vaultRoot>/<id>/<rev>/`,
 * where `rev` is a hash-derived revision key. Ingestion validates first (an
 * invalid skill never creates vault directories), stages a copy, verifies
 * the staged content hash against the source, and only then renames the
 * revision into place — so a partially copied revision is never visible at
 * its final path. Identical content re-ingests as a no-op.
 */

export interface IngestRequest {
  readonly sourceDir: string;
  readonly vaultRoot: string;
  /** Explicit canonical ID; overrides the frontmatter name (authoritative). */
  readonly id?: string;
}

export interface VaultEntry {
  readonly id: string;
  readonly contentHash: string;
  readonly vaultPath: string;
  readonly name: string;
  readonly description: string;
}

export interface IngestError {
  readonly code:
    | "vault/source-missing"
    | "vault/invalid-skill"
    | "vault/verify-failed"
    | "vault/io-error";
  readonly path: string;
  readonly message: string;
  readonly causes: readonly ParseError[];
}

export type IngestResult =
  | {
      readonly ok: true;
      readonly entry: VaultEntry;
      readonly alreadyPresent: boolean;
      readonly findings: readonly AlignmentFinding[];
    }
  | { readonly ok: false; readonly error: IngestError };

const fail = (
  code: IngestError["code"],
  errPath: string,
  message: string,
  causes: readonly ParseError[] = [],
): IngestResult => ({ ok: false, error: { code, path: errPath, message, causes } });

const REVISION_KEY_LENGTH = 12;

export function ingestLocalSkill(request: IngestRequest): IngestResult {
  const { sourceDir, vaultRoot } = request;

  // statSync follows links: a live junction to a directory is a valid
  // source (re-ingesting an already managed skill is an idempotent no-op).
  let sourceStats: fs.Stats | undefined;
  try {
    sourceStats = fs.statSync(sourceDir);
  } catch {
    sourceStats = undefined;
  }
  if (sourceStats === undefined || !sourceStats.isDirectory()) {
    return fail(
      "vault/source-missing",
      sourceDir,
      `Skill source is not a readable directory: ${sourceDir}`,
    );
  }

  const skillMdPath = path.join(sourceDir, "SKILL.md");
  if (!fs.existsSync(skillMdPath)) {
    return fail(
      "vault/invalid-skill",
      sourceDir,
      `Not a canonical skill: ${sourceDir} has no SKILL.md.`,
      [
        {
          code: "skill-md/missing",
          path: [],
          message: "SKILL.md not found in the skill directory.",
        },
      ],
    );
  }
  const parsed = parseSkillMd(fs.readFileSync(skillMdPath, "utf8"));
  if (!parsed.ok) {
    return fail(
      "vault/invalid-skill",
      skillMdPath,
      `SKILL.md failed validation for ${sourceDir}.`,
      parsed.errors,
    );
  }

  const id = request.id ?? parsed.skill.name;
  const findings = checkIdAlignment(id, {
    frontmatterName: parsed.skill.name,
  });

  const sourceHash = hashDirectory(sourceDir);
  if (!sourceHash.ok) {
    return fail("vault/io-error", sourceDir, sourceHash.error.message);
  }

  const revisionKey = sourceHash.hash
    .replace("sha256:", "")
    .slice(0, REVISION_KEY_LENGTH);
  const revisionPath = path.join(vaultRoot, id, revisionKey);

  const entry: VaultEntry = {
    id,
    contentHash: sourceHash.hash,
    vaultPath: revisionPath,
    name: parsed.skill.name,
    description: parsed.skill.description,
  };

  if (inspectPath(revisionPath).kind === "directory") {
    const existing = hashDirectory(revisionPath);
    if (existing.ok && existing.hash === sourceHash.hash) {
      return { ok: true, entry, alreadyPresent: true, findings };
    }
    return fail(
      "vault/verify-failed",
      revisionPath,
      `Vault revision ${revisionPath} exists but its content does not match its revision key.`,
    );
  }

  const stagingDir = path.join(vaultRoot, ".staging", `${id}-${revisionKey}`);
  try {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(stagingDir), { recursive: true });
    // dereference: a junction source (or nested links) is copied by the
    // content it resolves to, matching hashDirectory's stat-not-lstat
    // semantics — otherwise cpSync recreates the link itself and the staged
    // copy can never match the source hash. The staging directory must not
    // pre-exist: cpSync creates it, avoiding overwrite conflicts when the
    // source root is itself a link.
    fs.cpSync(sourceDir, stagingDir, { recursive: true, dereference: true });

    const stagedHash = hashDirectory(stagingDir);
    if (!stagedHash.ok || stagedHash.hash !== sourceHash.hash) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      return fail(
        "vault/verify-failed",
        stagingDir,
        "Staged copy does not match the source content hash.",
      );
    }

    fs.mkdirSync(path.dirname(revisionPath), { recursive: true });
    fs.renameSync(stagingDir, revisionPath);
    return { ok: true, entry, alreadyPresent: false, findings };
  } catch (error) {
    return fail(
      "vault/io-error",
      revisionPath,
      `Failed to ingest skill: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    const stagingRoot = path.join(vaultRoot, ".staging");
    if (fs.existsSync(stagingRoot) && fs.readdirSync(stagingRoot).length === 0) {
      fs.rmdirSync(stagingRoot);
    }
  }
}
