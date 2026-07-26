import { describe, expect, it } from "vitest";
import type { DeclaredSkillSource } from "../installers/lockfiles.js";
import {
  deriveProvenance,
  verifyProvenance,
  type UserAssertion,
} from "./model.js";

/**
 * M6 provenance confidence model. Invariants under test (from
 * IMPLEMENTATION_PLAN.md M6 verification):
 * - name-only repository similarity never becomes Verified;
 * - user corrections are distinguishable from independently verified;
 * - installer-declared metadata stays Declared until re-verified.
 */

const declared: DeclaredSkillSource = {
  skillId: "wrangler",
  bundle: "cloudflare/skills",
  sourceUrl: "https://github.com/cloudflare/skills.git",
  skillPath: "skills/wrangler/SKILL.md",
  evidence: "declared",
  lockfilePath: "C:/home/.agents/.skill-lock.json",
};

const userAssertion: UserAssertion = {
  repository: "obra/superpowers",
  assertedAt: "2026-07-27T10:00:00.000Z",
};

describe("deriveProvenance", () => {
  it("no evidence at all is unknown", () => {
    const record = deriveProvenance("mystery", {});
    expect(record).toEqual({
      skillId: "mystery",
      confidence: "unknown",
      evidence: [],
    });
  });

  it("installer lockfile evidence is declared — never more", () => {
    const record = deriveProvenance("wrangler", { declared: [declared] });
    expect(record.confidence).toBe("declared");
    expect(record.source?.repository).toBe("cloudflare/skills");
    expect(record.source?.subdir).toBe("skills/wrangler");
    expect(record.evidence[0]?.kind).toBe("installer-lockfile");
  });

  it("a user assertion is user-verified and wins over declared evidence", () => {
    const record = deriveProvenance("wrangler", {
      declared: [declared],
      user: userAssertion,
    });
    expect(record.confidence).toBe("user-verified");
    expect(record.source?.repository).toBe("obra/superpowers");
    // The installer evidence stays on the record for transparency.
    expect(record.evidence.map((e) => e.kind)).toEqual([
      "user-assertion",
      "installer-lockfile",
    ]);
  });

  it("a structural hint alone yields inferred, with the hint as evidence", () => {
    const record = deriveProvenance("linked", {
      structuralHint: "junction into the ~/.agents skills store",
    });
    expect(record.confidence).toBe("inferred");
    expect(record.source).toBeUndefined();
    expect(record.evidence[0]?.kind).toBe("structural-hint");
  });

  it("offers no input that turns name similarity into any confidence", () => {
    // The API accepts installer evidence, user assertions, structural
    // hints, and re-verification results — there is no name-similarity
    // input. This test locks the surface: unknown stays unknown even for a
    // skill whose ID matches a known bundle's skill names.
    const record = deriveProvenance("superpowers", {});
    expect(record.confidence).toBe("unknown");
  });
});

describe("verifyProvenance", () => {
  it("declared upgrades to verified only on a matching re-verification", () => {
    const record = deriveProvenance("wrangler", { declared: [declared] });
    const verified = verifyProvenance(record, {
      matches: true,
      commit: "a".repeat(40),
      checkedAt: "2026-07-27T11:00:00.000Z",
    });
    expect(verified.confidence).toBe("verified");
    expect(verified.lastVerifiedAt).toBe("2026-07-27T11:00:00.000Z");
    expect(verified.source?.commit).toBe("a".repeat(40));
    expect(verified.evidence.some((e) => e.kind === "re-verification")).toBe(true);
  });

  it("a mismatching re-verification keeps the prior confidence and records it", () => {
    const record = deriveProvenance("wrangler", { declared: [declared] });
    const still = verifyProvenance(record, {
      matches: false,
      commit: "b".repeat(40),
      checkedAt: "2026-07-27T11:00:00.000Z",
    });
    expect(still.confidence).toBe("declared");
    expect(still.lastVerifiedAt).toBeUndefined();
    expect(
      still.evidence.some(
        (e) => e.kind === "re-verification" && e.detail.includes("did not match"),
      ),
    ).toBe(true);
  });

  it("verifying unknown provenance is impossible — nothing to verify against", () => {
    const record = deriveProvenance("mystery", {});
    const after = verifyProvenance(record, {
      matches: true,
      commit: "c".repeat(40),
      checkedAt: "2026-07-27T11:00:00.000Z",
    });
    expect(after.confidence).toBe("unknown");
  });

  it("user-verified stays distinguishable until independently re-verified", () => {
    const record = deriveProvenance("brainstorming", { user: userAssertion });
    expect(record.confidence).toBe("user-verified");

    const verified = verifyProvenance(record, {
      matches: true,
      commit: "d".repeat(40),
      checkedAt: "2026-07-27T11:00:00.000Z",
    });
    expect(verified.confidence).toBe("verified");
    // The chain preserves that a user asserted it first.
    expect(verified.evidence.map((e) => e.kind)).toContain("user-assertion");
  });
});
