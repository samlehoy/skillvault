import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseAntigravityLockV1,
  parseSkillLockV3,
  readDeclaredBundles,
} from "./lockfiles.js";

/**
 * Installer lockfile parsers (Milestone 5). Schemas verified against the
 * real files on the reference machine (docs/adapters/M0_VERIFIED_FACTS.md):
 * vercel-labs `.skill-lock.json` version 3 and Antigravity
 * `skills-lock.json` version 1. Evidence read from them is always
 * **Declared** provenance — never Verified (that upgrade happens in M6).
 */

const V3_SAMPLE = {
  version: 3,
  skills: {
    wrangler: {
      source: "cloudflare/skills",
      sourceType: "github",
      sourceUrl: "https://github.com/cloudflare/skills.git",
      skillPath: "skills/wrangler/SKILL.md",
      skillFolderHash: "45cc198b2aad3f06e8abf91333f55fbe7579f659",
      installedAt: "2026-06-11T08:47:35.235Z",
      updatedAt: "2026-06-11T08:50:08.464Z",
    },
    "find-skills": {
      source: "vercel-labs/skills",
      sourceType: "github",
      sourceUrl: "https://github.com/vercel-labs/skills.git",
      skillPath: "skills/find-skills/SKILL.md",
      skillFolderHash: "3013fdeb8a11b10b1eb795ec3ae8bfca38f7c26d",
      installedAt: "2026-04-20T08:17:59.266Z",
      updatedAt: "2026-04-20T08:17:59.266Z",
    },
  },
};

const V1_SAMPLE = {
  version: 1,
  skills: {
    "motion-design": {
      source: "LottieFiles/motion-design-skill",
      sourceType: "github",
      skillPath: "skills/motion-design/SKILL.md",
      computedHash: "4f16f46c81f25a2a25b7a4720b7ea001e65f384b31b5b7f4b455fef87fbc9016",
    },
  },
};

describe("parseSkillLockV3", () => {
  it("extracts Declared bundle sources per skill", () => {
    const result = parseSkillLockV3(V3_SAMPLE, "C:/home/.agents/.skill-lock.json");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources).toEqual([
      {
        skillId: "find-skills",
        bundle: "vercel-labs/skills",
        sourceUrl: "https://github.com/vercel-labs/skills.git",
        skillPath: "skills/find-skills/SKILL.md",
        evidence: "declared",
        lockfilePath: "C:/home/.agents/.skill-lock.json",
      },
      {
        skillId: "wrangler",
        bundle: "cloudflare/skills",
        sourceUrl: "https://github.com/cloudflare/skills.git",
        skillPath: "skills/wrangler/SKILL.md",
        evidence: "declared",
        lockfilePath: "C:/home/.agents/.skill-lock.json",
      },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it("fails closed on unknown lockfile versions", () => {
    const result = parseSkillLockV3({ version: 4, skills: {} }, "x");
    expect(!result.ok && result.error.code).toBe("installer-lock/unsupported-version");
  });

  it("tolerates unknown extra fields but skips entries without a source", () => {
    const result = parseSkillLockV3(
      {
        version: 3,
        skills: {
          good: {
            source: "obra/superpowers",
            sourceType: "github",
            futureField: true,
          },
          bad: { sourceType: "github" },
        },
      },
      "x",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources.map((s) => s.skillId)).toEqual(["good"]);
    expect(result.sources[0]?.bundle).toBe("obra/superpowers");
    expect(result.skipped).toEqual([
      { skillId: "bad", reason: expect.stringContaining("source") },
    ]);
  });

  it("rejects non-object input", () => {
    const result = parseSkillLockV3("nope", "x");
    expect(!result.ok && result.error.code).toBe("installer-lock/invalid");
  });
});

describe("parseAntigravityLockV1", () => {
  it("extracts Declared bundle sources per skill", () => {
    const result = parseAntigravityLockV1(
      V1_SAMPLE,
      "C:/home/.gemini/antigravity/skills-lock.json",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sources).toEqual([
      {
        skillId: "motion-design",
        bundle: "LottieFiles/motion-design-skill",
        skillPath: "skills/motion-design/SKILL.md",
        evidence: "declared",
        lockfilePath: "C:/home/.gemini/antigravity/skills-lock.json",
      },
    ]);
  });

  it("fails closed on unknown versions", () => {
    const result = parseAntigravityLockV1({ version: 2, skills: {} }, "x");
    expect(!result.ok && result.error.code).toBe("installer-lock/unsupported-version");
  });
});

describe("readDeclaredBundles", () => {
  let homeDir: string;

  beforeAll(() => {
    homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-lockread-"));
    fs.mkdirSync(path.join(homeDir, ".agents"), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, ".agents", ".skill-lock.json"),
      JSON.stringify(V3_SAMPLE),
      "utf8",
    );
    fs.mkdirSync(path.join(homeDir, ".gemini", "antigravity"), { recursive: true });
    fs.writeFileSync(
      path.join(homeDir, ".gemini", "antigravity", "skills-lock.json"),
      JSON.stringify(V1_SAMPLE),
      "utf8",
    );
  });

  afterAll(() => {
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  it("aggregates evidence from every present lockfile, keyed by skill ID", () => {
    const { declared, warnings } = readDeclaredBundles({ homeDir });
    expect(warnings).toEqual([]);
    expect(declared.get("wrangler")?.[0]?.bundle).toBe("cloudflare/skills");
    expect(declared.get("find-skills")?.[0]?.bundle).toBe("vercel-labs/skills");
    expect(declared.get("motion-design")?.[0]?.bundle).toBe(
      "LottieFiles/motion-design-skill",
    );
  });

  it("treats missing lockfiles as absent evidence, not errors", () => {
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-nolock-"));
    try {
      const { declared, warnings } = readDeclaredBundles({ homeDir: emptyHome });
      expect(declared.size).toBe(0);
      expect(warnings).toEqual([]);
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it("surfaces malformed lockfiles as warnings without failing discovery", () => {
    const brokenHome = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-badlock-"));
    try {
      fs.mkdirSync(path.join(brokenHome, ".agents"), { recursive: true });
      fs.writeFileSync(
        path.join(brokenHome, ".agents", ".skill-lock.json"),
        "{broken",
        "utf8",
      );
      const { declared, warnings } = readDeclaredBundles({ homeDir: brokenHome });
      expect(declared.size).toBe(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(".skill-lock.json");
    } finally {
      fs.rmSync(brokenHome, { recursive: true, force: true });
    }
  });
});
