import { discoverSkills as discoverAntigravitySkills } from "../adapters/antigravity.js";
import { discoverSkills as discoverOpencodeSkills } from "../adapters/opencode.js";
import { hashDirectory } from "../fs/hash.js";

/**
 * Existing-skill fingerprinting and duplicate/conflict classification
 * (Milestone 5). `fingerprint` is a pure, deterministic function over
 * precomputed content hashes; `scanFingerprints` feeds it from read-only
 * adapter discovery. Neither ever mutates anything.
 *
 * Classification, per PRODUCT.md:
 * - exact duplicate: same ID, same content, multiple paths — safe to manage
 *   as one canonical skill.
 * - conflict: same ID, divergent content — blocks management until the user
 *   picks a canonical copy.
 * - likely duplicate: different IDs, identical content — a rename candidate
 *   reported for review, never auto-merged.
 */

export interface FingerprintEntry {
  readonly id: string;
  readonly path: string;
  readonly locationKey: string;
  /** `sha256:<hex>`, or the literal "unreadable" when hashing failed. */
  readonly contentHash: string;
}

export interface FingerprintReport {
  readonly exactDuplicates: readonly {
    readonly id: string;
    readonly contentHash: string;
    readonly paths: readonly string[];
  }[];
  readonly conflicts: readonly {
    readonly id: string;
    readonly variants: readonly {
      readonly contentHash: string;
      readonly paths: readonly string[];
    }[];
  }[];
  readonly likelyDuplicates: readonly {
    readonly contentHash: string;
    readonly ids: readonly string[];
  }[];
  readonly unreadable: readonly { readonly id: string; readonly path: string }[];
}

export function fingerprint(
  entries: readonly FingerprintEntry[],
): FingerprintReport {
  const unreadable = entries
    .filter((e) => e.contentHash === "unreadable")
    .map((e) => ({ id: e.id, path: e.path }))
    .sort((a, b) => a.id.localeCompare(b.id) || a.path.localeCompare(b.path));
  const readable = entries.filter((e) => e.contentHash !== "unreadable");

  const byId = new Map<string, FingerprintEntry[]>();
  for (const e of readable) {
    const list = byId.get(e.id) ?? [];
    list.push(e);
    byId.set(e.id, list);
  }

  const exactDuplicates: { id: string; contentHash: string; paths: string[] }[] = [];
  const conflicts: {
    id: string;
    variants: { contentHash: string; paths: string[] }[];
  }[] = [];
  for (const [id, group] of [...byId.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const byHash = new Map<string, string[]>();
    for (const e of group) {
      const paths = byHash.get(e.contentHash) ?? [];
      paths.push(e.path);
      byHash.set(e.contentHash, paths);
    }
    const variants = [...byHash.entries()]
      .map(([contentHash, paths]) => ({ contentHash, paths: paths.sort() }))
      .sort((a, b) => a.contentHash.localeCompare(b.contentHash));
    if (variants.length > 1) {
      conflicts.push({ id, variants });
    } else if (variants.length === 1 && group.length > 1) {
      const only = variants[0];
      if (only) {
        exactDuplicates.push({ id, contentHash: only.contentHash, paths: only.paths });
      }
    }
  }

  const idsByHash = new Map<string, Set<string>>();
  for (const e of readable) {
    const ids = idsByHash.get(e.contentHash) ?? new Set<string>();
    ids.add(e.id);
    idsByHash.set(e.contentHash, ids);
  }
  const likelyDuplicates = [...idsByHash.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([contentHash, ids]) => ({ contentHash, ids: [...ids].sort() }))
    .sort((a, b) => a.contentHash.localeCompare(b.contentHash));

  return { exactDuplicates, conflicts, likelyDuplicates, unreadable };
}

export interface ScanEnvironment {
  readonly homeDir: string;
  readonly projectDir?: string;
}

/**
 * Hashes every discovered skill location across the supported adapters and
 * classifies the result. Dangling junctions are reported as unreadable
 * (their broken-link health is already covered by the inventory).
 */
export function scanFingerprints(env: ScanEnvironment): FingerprintReport {
  const discovered = [
    ...discoverOpencodeSkills({
      homeDir: env.homeDir,
      ...(env.projectDir !== undefined ? { projectDir: env.projectDir } : {}),
    }),
    ...discoverAntigravitySkills({ homeDir: env.homeDir }),
  ];
  const entries: FingerprintEntry[] = discovered.map((skill) => {
    if (skill.dangling) {
      return {
        id: skill.id,
        path: skill.path,
        locationKey: skill.location,
        contentHash: "unreadable",
      };
    }
    const hashed = hashDirectory(skill.path);
    return {
      id: skill.id,
      path: skill.path,
      locationKey: skill.location,
      contentHash: hashed.ok ? hashed.hash : "unreadable",
    };
  });
  return fingerprint(entries);
}
