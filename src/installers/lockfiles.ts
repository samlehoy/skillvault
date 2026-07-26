import fs from "node:fs";
import path from "node:path";

/**
 * Third-party installer lockfile readers (Milestone 5; bundle-label slice
 * pulled forward from M6 — see TUI_FLOW.md "bundle grouping" and ADR-0005).
 *
 * Two known layouts, both verified against real files on the reference
 * machine (docs/adapters/M0_VERIFIED_FACTS.md):
 *
 * - vercel-labs `skills` CLI: `~/.agents/.skill-lock.json`, version 3.
 * - Antigravity: `~/.gemini/antigravity{,-ide}/skills-lock.json`, version 1.
 *
 * Everything read here is **Declared** provenance: the installer's claim
 * about where a skill came from, taken at face value and labelled as such.
 * It never upgrades to Verified inside this module (re-verification against
 * the declared repository is M6 work). Unknown file versions fail closed;
 * individual malformed entries are skipped and reported rather than
 * discarding the whole file, because these files are third-party output we
 * do not control. All reads are strictly read-only.
 */

export interface DeclaredSkillSource {
  readonly skillId: string;
  /** Source repository label, e.g. "obra/superpowers". */
  readonly bundle: string;
  readonly sourceUrl?: string;
  /** Path of the skill's SKILL.md inside the source repository. */
  readonly skillPath?: string;
  readonly evidence: "declared";
  readonly lockfilePath: string;
}

export interface SkippedEntry {
  readonly skillId: string;
  readonly reason: string;
}

export interface InstallerLockError {
  readonly code: "installer-lock/invalid" | "installer-lock/unsupported-version";
  readonly message: string;
}

export type InstallerLockResult =
  | {
      readonly ok: true;
      readonly sources: readonly DeclaredSkillSource[];
      readonly skipped: readonly SkippedEntry[];
    }
  | { readonly ok: false; readonly error: InstallerLockError };

function parseInstallerLock(
  data: unknown,
  lockfilePath: string,
  expectedVersion: number,
): InstallerLockResult {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return {
      ok: false,
      error: {
        code: "installer-lock/invalid",
        message: `${lockfilePath} is not a JSON object.`,
      },
    };
  }
  const record = data as Record<string, unknown>;
  if (record["version"] !== expectedVersion) {
    return {
      ok: false,
      error: {
        code: "installer-lock/unsupported-version",
        message: `${lockfilePath} has version ${JSON.stringify(record["version"])}; this build understands version ${expectedVersion} only.`,
      },
    };
  }
  const skills = record["skills"];
  if (typeof skills !== "object" || skills === null || Array.isArray(skills)) {
    return {
      ok: false,
      error: {
        code: "installer-lock/invalid",
        message: `${lockfilePath} has no "skills" object.`,
      },
    };
  }

  const sources: DeclaredSkillSource[] = [];
  const skipped: SkippedEntry[] = [];
  for (const [skillId, raw] of Object.entries(skills as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (typeof raw !== "object" || raw === null) {
      skipped.push({ skillId, reason: "entry is not an object" });
      continue;
    }
    const entry = raw as Record<string, unknown>;
    const bundle = entry["source"];
    if (typeof bundle !== "string" || bundle === "") {
      skipped.push({ skillId, reason: 'entry has no "source" repository label' });
      continue;
    }
    const sourceUrl = entry["sourceUrl"];
    const skillPath = entry["skillPath"];
    sources.push({
      skillId,
      bundle,
      ...(typeof sourceUrl === "string" ? { sourceUrl } : {}),
      ...(typeof skillPath === "string" ? { skillPath } : {}),
      evidence: "declared",
      lockfilePath,
    });
  }
  return { ok: true, sources, skipped };
}

/** vercel-labs `skills` CLI lockfile, `~/.agents/.skill-lock.json`. */
export function parseSkillLockV3(
  data: unknown,
  lockfilePath: string,
): InstallerLockResult {
  return parseInstallerLock(data, lockfilePath, 3);
}

/** Antigravity lockfile, `~/.gemini/antigravity{,-ide}/skills-lock.json`. */
export function parseAntigravityLockV1(
  data: unknown,
  lockfilePath: string,
): InstallerLockResult {
  return parseInstallerLock(data, lockfilePath, 1);
}

export interface DeclaredBundles {
  /** Evidence per skill ID, in lockfile priority order (agents store first). */
  readonly declared: ReadonlyMap<string, readonly DeclaredSkillSource[]>;
  /** Human-readable notes about unreadable or unsupported lockfiles. */
  readonly warnings: readonly string[];
}

/**
 * Reads every known installer lockfile under the home directory. Missing
 * files are absent evidence; malformed or unsupported files become warnings
 * — discovery must never fail because a third-party file changed shape.
 */
export function readDeclaredBundles(env: { homeDir: string }): DeclaredBundles {
  const candidates: readonly {
    filePath: string;
    parse: (data: unknown, lockfilePath: string) => InstallerLockResult;
  }[] = [
    {
      filePath: path.join(env.homeDir, ".agents", ".skill-lock.json"),
      parse: parseSkillLockV3,
    },
    {
      filePath: path.join(env.homeDir, ".gemini", "antigravity", "skills-lock.json"),
      parse: parseAntigravityLockV1,
    },
    {
      filePath: path.join(env.homeDir, ".gemini", "antigravity-ide", "skills-lock.json"),
      parse: parseAntigravityLockV1,
    },
  ];

  const declared = new Map<string, DeclaredSkillSource[]>();
  const warnings: string[] = [];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.filePath)) continue;
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(candidate.filePath, "utf8"));
    } catch (error) {
      warnings.push(
        `${candidate.filePath} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const parsed = candidate.parse(data, candidate.filePath);
    if (!parsed.ok) {
      warnings.push(parsed.error.message);
      continue;
    }
    for (const source of parsed.sources) {
      const list = declared.get(source.skillId) ?? [];
      list.push(source);
      declared.set(source.skillId, list);
    }
    for (const skip of parsed.skipped) {
      warnings.push(
        `${candidate.filePath}: entry "${skip.skillId}" skipped (${skip.reason}).`,
      );
    }
  }
  return { declared, warnings };
}
