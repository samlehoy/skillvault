import { describe, expect, it } from "vitest";
import { parseLockfile, parseManifest } from "./manifest.js";

const validManifest = {
  schema: 1,
  skills: {
    "code-review": {
      source: {
        type: "git",
        repository: "https://github.com/example/agent-skills.git",
        subdir: "skills/code-review",
        ref: "main",
      },
      targets: ["opencode", "antigravity"],
    },
    "local-notes": {
      source: { type: "local", path: "../skills/local-notes" },
    },
    "noisy-skill": { disabled: true },
  },
};

describe("parseManifest", () => {
  it("accepts a valid manifest with git, local, and disabled entries", () => {
    const result = parseManifest(validManifest);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.manifest.skills).sort()).toEqual([
        "code-review",
        "local-notes",
        "noisy-skill",
      ]);
      expect(result.manifest.skills["noisy-skill"]).toEqual({ disabled: true });
    }
  });

  it("rejects non-object input", () => {
    const result = parseManifest("nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("manifest/not-object");
    }
  });

  it("rejects a missing schema version", () => {
    const result = parseManifest({ skills: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("manifest/unsupported-schema");
    }
  });

  it("rejects a future schema version without partial interpretation", () => {
    const result = parseManifest({ ...validManifest, schema: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]?.code).toBe("manifest/unsupported-schema");
      expect(result.errors[0]?.message).toContain("2");
    }
  });

  it("rejects non-canonical skill ids with the offending path", () => {
    const result = parseManifest({
      schema: 1,
      skills: { "Code Review": { source: { type: "local", path: "x" } } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find((e) => e.code === "manifest/invalid-id");
      expect(err).toBeDefined();
      expect(err?.path).toEqual(["skills", "Code Review"]);
    }
  });

  it("rejects unknown source types", () => {
    const result = parseManifest({
      schema: 1,
      skills: { a: { source: { type: "npm", package: "x" } } },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects unknown keys instead of ignoring them", () => {
    const result = parseManifest({
      schema: 1,
      skills: {
        a: { source: { type: "local", path: "x" }, sneaky: true },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects empty targets arrays", () => {
    const result = parseManifest({
      schema: 1,
      skills: { a: { source: { type: "local", path: "x" }, targets: [] } },
    });
    expect(result.ok).toBe(false);
  });
});

const validLockfile = {
  schema: 1,
  skills: {
    "code-review": {
      source: {
        type: "git",
        repository: "https://github.com/example/agent-skills.git",
        subdir: "skills/code-review",
      },
      resolved: {
        commit: "56c4f8b8d7d42fc6d30f5369759b28f10ad12abc",
        contentHash:
          "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      },
    },
    "local-notes": {
      source: { type: "local", path: "../skills/local-notes" },
      resolved: {
        contentHash:
          "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      },
    },
  },
};

describe("parseLockfile", () => {
  it("accepts a valid lockfile", () => {
    const result = parseLockfile(validLockfile);
    expect(result.ok).toBe(true);
  });

  it("rejects a future schema version", () => {
    const result = parseLockfile({ ...validLockfile, schema: 99 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("lockfile/unsupported-schema");
    }
  });

  it("requires a commit for git entries", () => {
    const result = parseLockfile({
      schema: 1,
      skills: {
        a: {
          source: { type: "git", repository: "https://x.git" },
          resolved: { contentHash: "sha256:abc" },
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects malformed commit SHAs", () => {
    const result = parseLockfile({
      schema: 1,
      skills: {
        a: {
          source: { type: "git", repository: "https://x.git" },
          resolved: { commit: "not-a-sha", contentHash: "sha256:abc" },
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects content hashes without an algorithm prefix", () => {
    const result = parseLockfile({
      schema: 1,
      skills: {
        a: {
          source: { type: "local", path: "x" },
          resolved: { contentHash: "deadbeef" },
        },
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a ref inside lockfile sources (lock entries must not track moving refs)", () => {
    const result = parseLockfile({
      schema: 1,
      skills: {
        a: {
          source: { type: "git", repository: "https://x.git", ref: "main" },
          resolved: {
            commit: "56c4f8b8d7d42fc6d30f5369759b28f10ad12abc",
            contentHash: "sha256:abc",
          },
        },
      },
    });
    expect(result.ok).toBe(false);
  });
});
