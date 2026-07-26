import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  parseLockfile,
  parseManifest,
  type LockEntry,
  type Lockfile,
  type Manifest,
  type ParseError,
} from "../core/manifest.js";

/**
 * Project manifest/lockfile file workflow (Milestone 4): `.skillvault/
 * skills.yaml` (user-authored, YAML) and `.skillvault/skills.lock.json`
 * (machine-written, JSON) inside a project directory, both suitable for
 * source control. The lockfile serializer is deterministic — sorted skill
 * keys, LF line endings, trailing newline — so rewrites never churn diffs.
 *
 * Schema validation stays in `core/manifest.ts`; this module only adds file
 * and syntax handling. An absent file is a legitimate state (`present:
 * false`), never an error.
 */

const PROJECT_DIR_NAME = ".skillvault";

export const manifestPathFor = (projectDir: string): string =>
  path.join(projectDir, PROJECT_DIR_NAME, "skills.yaml");

export const lockfilePathFor = (projectDir: string): string =>
  path.join(projectDir, PROJECT_DIR_NAME, "skills.lock.json");

export type LoadResult<TKey extends string, TDoc> =
  | { readonly ok: true; readonly present: false }
  | ({ readonly ok: true; readonly present: true } & {
      readonly [K in TKey]: TDoc;
    })
  | { readonly ok: false; readonly errors: readonly ParseError[] };

export function loadProjectManifest(
  projectDir: string,
): LoadResult<"manifest", Manifest> {
  const filePath = manifestPathFor(projectDir);
  if (!fs.existsSync(filePath)) return { ok: true, present: false };

  let data: unknown;
  try {
    data = YAML.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          code: "manifest/invalid-yaml",
          path: [],
          message: `${filePath} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  const parsed = parseManifest(data);
  if (!parsed.ok) return parsed;
  return { ok: true, present: true, manifest: parsed.manifest };
}

export function loadProjectLockfile(
  projectDir: string,
): LoadResult<"lockfile", Lockfile> {
  const filePath = lockfilePathFor(projectDir);
  if (!fs.existsSync(filePath)) return { ok: true, present: false };

  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          code: "lockfile/invalid-json",
          path: [],
          message: `${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
  const parsed = parseLockfile(data);
  if (!parsed.ok) return parsed;
  return { ok: true, present: true, lockfile: parsed.lockfile };
}

export function saveProjectLockfile(
  projectDir: string,
  lockfile: Lockfile,
): string {
  const filePath = lockfilePathFor(projectDir);
  const sortedSkills = Object.fromEntries(
    Object.entries(lockfile.skills).sort(([a], [b]) => a.localeCompare(b)),
  );
  const document: Lockfile = { schema: lockfile.schema, skills: sortedSkills };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return filePath;
}

/**
 * Pure lock update: the reviewed-update flow calls this only after the user
 * approves the plan built from `checkGitUpdate`, then persists the result
 * with `saveProjectLockfile`. The input lockfile is never mutated.
 */
export function applyLockUpdate(
  lockfile: Lockfile,
  id: string,
  entry: LockEntry,
): Lockfile {
  return {
    schema: lockfile.schema,
    skills: { ...lockfile.skills, [id]: entry },
  };
}
