import path from "node:path";
import type { DeclaredSkillSource } from "../installers/lockfiles.js";

/**
 * Provenance confidence model (Milestone 6). Every skill's attribution
 * carries a confidence level derived strictly from evidence:
 *
 * - `verified`      — content re-verified against the attributed repository.
 * - `user-verified` — the user asserted the source; distinguishable from
 *                     independent verification by design.
 * - `declared`      — a third-party installer lockfile claims the source.
 * - `inferred`      — structural evidence only (e.g. a junction into a
 *                     known installer store), no explicit claim.
 * - `unknown`       — no evidence.
 *
 * There is deliberately no input for name similarity: an ID that merely
 * looks like it belongs to a repository can never gain confidence. Upgrading
 * to `verified` happens only through {@link verifyProvenance} with a real
 * re-verification result.
 */

export type Confidence =
  | "verified"
  | "user-verified"
  | "declared"
  | "inferred"
  | "unknown";

export interface SourceRef {
  readonly repository: string;
  readonly subdir?: string;
  readonly commit?: string;
}

export interface EvidenceItem {
  readonly kind:
    | "installer-lockfile"
    | "user-assertion"
    | "structural-hint"
    | "re-verification";
  readonly detail: string;
}

export interface ProvenanceRecord {
  readonly skillId: string;
  readonly confidence: Confidence;
  readonly source?: SourceRef;
  readonly evidence: readonly EvidenceItem[];
  /** Set only while confidence is `verified`. */
  readonly lastVerifiedAt?: string;
}

export interface UserAssertion {
  readonly repository: string;
  readonly subdir?: string;
  readonly assertedAt: string;
}

export interface ProvenanceInputs {
  readonly declared?: readonly DeclaredSkillSource[];
  readonly user?: UserAssertion;
  /** Structural observation, e.g. "junction into the ~/.agents store". */
  readonly structuralHint?: string;
}

const subdirFromSkillPath = (skillPath: string | undefined): string | undefined => {
  if (skillPath === undefined) return undefined;
  const dir = path.posix.dirname(skillPath.replaceAll("\\", "/"));
  return dir === "." ? undefined : dir;
};

export function deriveProvenance(
  skillId: string,
  inputs: ProvenanceInputs,
): ProvenanceRecord {
  const installerEvidence: EvidenceItem[] = (inputs.declared ?? []).map((d) => ({
    kind: "installer-lockfile",
    detail: `${d.lockfilePath} declares ${d.bundle}${d.skillPath !== undefined ? ` (${d.skillPath})` : ""}`,
  }));

  if (inputs.user !== undefined) {
    return {
      skillId,
      confidence: "user-verified",
      source: {
        repository: inputs.user.repository,
        ...(inputs.user.subdir !== undefined ? { subdir: inputs.user.subdir } : {}),
      },
      evidence: [
        {
          kind: "user-assertion",
          detail: `User asserted ${inputs.user.repository} at ${inputs.user.assertedAt}`,
        },
        ...installerEvidence,
      ],
    };
  }

  const primary = inputs.declared?.[0];
  if (primary !== undefined) {
    const subdir = subdirFromSkillPath(primary.skillPath);
    return {
      skillId,
      confidence: "declared",
      source: {
        repository: primary.bundle,
        ...(subdir !== undefined ? { subdir } : {}),
      },
      evidence: installerEvidence,
    };
  }

  if (inputs.structuralHint !== undefined) {
    return {
      skillId,
      confidence: "inferred",
      evidence: [{ kind: "structural-hint", detail: inputs.structuralHint }],
    };
  }

  return { skillId, confidence: "unknown", evidence: [] };
}

export interface VerificationResult {
  readonly matches: boolean;
  readonly commit: string;
  readonly checkedAt: string;
}

/**
 * Applies a re-verification outcome (content compared against the
 * attributed repository — performed by the Git resolver, injected here as a
 * result). Only a match upgrades to `verified`; a mismatch is recorded but
 * never silently downgrades or upgrades anything. Records without an
 * attributed source cannot be verified at all.
 */
export function verifyProvenance(
  record: ProvenanceRecord,
  result: VerificationResult,
): ProvenanceRecord {
  if (record.source === undefined) return record;

  if (!result.matches) {
    return {
      ...record,
      evidence: [
        ...record.evidence,
        {
          kind: "re-verification",
          detail: `Content did not match ${record.source.repository}@${result.commit} at ${result.checkedAt}`,
        },
      ],
    };
  }

  return {
    skillId: record.skillId,
    confidence: "verified",
    source: { ...record.source, commit: result.commit },
    evidence: [
      ...record.evidence,
      {
        kind: "re-verification",
        detail: `Content matched ${record.source.repository}@${result.commit} at ${result.checkedAt}`,
      },
    ],
    lastVerifiedAt: result.checkedAt,
  };
}
