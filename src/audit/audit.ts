import path from "node:path";
import { createTuiCore } from "../app/core.js";
import { scanFingerprints } from "../discovery/fingerprint.js";
import { findInterrupted } from "../transaction/journal.js";

/**
 * Read-only audit engine (Milestone 6). Findings carry stable identifiers
 * (`<category>:<subject>`), a severity, and a remediation intent, so both
 * the TUI and `skillvault audit --json` can render them and scripts can
 * track them across runs. The audit never mutates anything — it reuses the
 * read-only discovery, fingerprint, and journal readers.
 */

export type AuditCategory =
  | "broken-link"
  | "content-conflict"
  | "likely-duplicate"
  | "duplicate-visibility"
  | "unknown-provenance"
  | "interrupted-transaction";

export type AuditSeverity = "error" | "warn" | "info";

export interface AuditFinding {
  readonly id: string;
  readonly category: AuditCategory;
  readonly severity: AuditSeverity;
  readonly skillId?: string;
  readonly paths: readonly string[];
  readonly message: string;
  readonly remediation: string;
}

export interface AuditReport {
  readonly findings: readonly AuditFinding[];
  /** True when no error-severity finding exists (warn/info never fail). */
  readonly ok: boolean;
}

export interface AuditEnvironment {
  readonly homeDir: string;
  readonly projectDir?: string;
}

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  error: 0,
  warn: 1,
  info: 2,
};

export function runAudit(env: AuditEnvironment): AuditReport {
  const core = createTuiCore(env);
  const inventory = core.loadInventory();
  const fingerprints = scanFingerprints(env);
  const interrupted = findInterrupted(
    path.join(env.homeDir, ".skillvault", "state"),
  );

  const findings: AuditFinding[] = [];

  for (const row of inventory) {
    const brokenPaths = row.locations
      .filter((l) => l.health === "broken")
      .map((l) => l.path);
    if (brokenPaths.length > 0) {
      findings.push({
        id: `broken-link:${row.id}`,
        category: "broken-link",
        severity: "error",
        skillId: row.id,
        paths: brokenPaths,
        message: `"${row.id}" has ${brokenPaths.length} link(s) whose target no longer exists.`,
        remediation:
          "Open the TUI, select the skill, and relink it from the vault — or remove the dead link.",
      });
    }
    if (row.bundle === undefined) {
      findings.push({
        id: `unknown-provenance:${row.id}`,
        category: "unknown-provenance",
        severity: "info",
        skillId: row.id,
        paths: row.locations.map((l) => l.path),
        message: `No evidence records where "${row.id}" came from.`,
        remediation:
          "If you know the source repository, press s in the skill's action panel to record it (user-verified).",
      });
    }
  }

  for (const conflict of fingerprints.conflicts) {
    findings.push({
      id: `content-conflict:${conflict.id}`,
      category: "content-conflict",
      severity: "error",
      skillId: conflict.id,
      paths: conflict.variants.flatMap((v) => v.paths),
      message: `"${conflict.id}" exists as ${conflict.variants.length} different contents under the same ID; management is blocked until one is chosen.`,
      remediation:
        "Open the skill in the TUI and pick the canonical copy; the others are backed up, never merged.",
    });
  }

  for (const dup of fingerprints.exactDuplicates) {
    findings.push({
      id: `duplicate-visibility:${dup.id}`,
      category: "duplicate-visibility",
      severity: "info",
      skillId: dup.id,
      paths: dup.paths,
      message: `"${dup.id}" is visible from ${dup.paths.length} independent locations with identical content.`,
      remediation:
        "Manage the skill to replace the copies with junctions to one vault revision (zero drift).",
    });
  }

  for (const likely of fingerprints.likelyDuplicates) {
    findings.push({
      id: `likely-duplicate:${likely.contentHash.slice(7, 19)}`,
      category: "likely-duplicate",
      severity: "warn",
      paths: [],
      message: `Skills ${likely.ids.map((i) => `"${i}"`).join(" and ")} have identical content under different IDs — likely the same skill renamed.`,
      remediation:
        "Review whether these are the same skill; keep one ID and remove the other to avoid double maintenance.",
    });
  }

  for (const entry of interrupted) {
    findings.push({
      id: `interrupted-transaction:${entry.planId}`,
      category: "interrupted-transaction",
      severity: "error",
      paths: [],
      message: `Transaction ${entry.planId} is ${entry.status} (${entry.applied.length}/${entry.operations.length} operations applied).`,
      remediation:
        "Backups are preserved under ~/.skillvault/backups; inspect the journal entry and re-apply or restore.",
    });
  }

  findings.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.id.localeCompare(b.id),
  );
  return {
    findings,
    ok: !findings.some((f) => f.severity === "error"),
  };
}
