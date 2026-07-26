import { describe, expect, it } from "vitest";
import type { Manifest } from "./manifest.js";
import {
  createPlan,
  invertOperation,
  isPlanStale,
  type Operation,
} from "./plan.js";

const manifest = (skills: Manifest["skills"]): Manifest => ({
  schema: 1,
  skills,
});

const before = manifest({
  "code-review": { source: { type: "local", path: "C:/skills/code-review" } },
});
const after = manifest({
  "code-review": { source: { type: "local", path: "C:/skills/code-review" } },
  web2md: { source: { type: "git", repository: "https://example.com/r.git" } },
});

const linkCreate: Operation = {
  kind: "link-create",
  installationId: "opencode-global",
  path: "C:/Users/dev/.config/opencode/skills/web2md",
  targetPath: "C:/Users/dev/.skillkeep/vault/web2md",
};

describe("invertOperation", () => {
  it("inverts link-create into link-remove and back", () => {
    const inverse = invertOperation(linkCreate);
    expect(inverse).toEqual({ ...linkCreate, kind: "link-remove" });
    expect(invertOperation(inverse!)).toEqual(linkCreate);
  });

  it("inverts vault-stage into vault-unstage", () => {
    const stage: Operation = {
      kind: "vault-stage",
      skillId: "web2md",
      contentHash: "sha256:abc123",
    };
    expect(invertOperation(stage)).toEqual({
      kind: "vault-unstage",
      skillId: "web2md",
      contentHash: "sha256:abc123",
    });
  });

  it("inverts a manifest write by writing the prior manifest back", () => {
    const op: Operation = {
      kind: "manifest-write",
      scope: "global",
      before,
      after,
    };
    expect(invertOperation(op)).toEqual({
      kind: "manifest-write",
      scope: "global",
      before: after,
      after: before,
    });
  });

  it("cannot invert a manifest write that created the first manifest", () => {
    const op: Operation = {
      kind: "manifest-write",
      scope: "global",
      before: null,
      after,
    };
    expect(invertOperation(op)).toBeNull();
  });

  it("inverts a backup into a restore, and restore is terminal", () => {
    const backup: Operation = {
      kind: "backup",
      sourcePath: "C:/target/skill",
      backupId: "bk-1",
    };
    const restore = invertOperation(backup);
    expect(restore).toEqual({
      kind: "restore",
      backupId: "bk-1",
      targetPath: "C:/target/skill",
    });
    expect(invertOperation(restore!)).toBeNull();
  });
});

describe("createPlan", () => {
  const input = {
    preconditions: [
      { key: "manifest:global", value: "sha256:aaa" },
      { key: "target:opencode-global/web2md", value: "absent" },
    ],
    operations: [linkCreate],
    ownership: [
      { path: linkCreate.path, ownership: "unknown" as const },
      { path: "C:/Users/dev/.skillkeep/vault/web2md", ownership: "skillkeep-owned" as const },
    ],
    postConditions: ["target:opencode-global/web2md linked"],
  };

  it("derives the same id for identical input", () => {
    expect(createPlan(input).id).toBe(createPlan(input).id);
  });

  it("derives the same id regardless of object key insertion order", () => {
    const reordered = {
      postConditions: ["target:opencode-global/web2md linked"],
      ownership: [
        { ownership: "unknown" as const, path: linkCreate.path },
        { ownership: "skillkeep-owned" as const, path: "C:/Users/dev/.skillkeep/vault/web2md" },
      ],
      operations: [
        {
          targetPath: linkCreate.targetPath,
          path: linkCreate.path,
          installationId: linkCreate.installationId,
          kind: "link-create",
        } as Operation,
      ],
      preconditions: [
        { key: "manifest:global", value: "sha256:aaa" },
        { key: "target:opencode-global/web2md", value: "absent" },
      ],
    };
    expect(createPlan(reordered).id).toBe(createPlan(input).id);
  });

  it("derives a different id when a precondition changes", () => {
    const changed = {
      ...input,
      preconditions: [{ key: "manifest:global", value: "sha256:bbb" }],
    };
    expect(createPlan(changed).id).not.toBe(createPlan(input).id);
  });

  it("marks the plan reversible only when every operation has an inverse", () => {
    expect(createPlan(input).reversible).toBe(true);
    const withCreation = {
      ...input,
      operations: [
        ...input.operations,
        { kind: "manifest-write", scope: "global", before: null, after } as Operation,
      ],
    };
    expect(createPlan(withCreation).reversible).toBe(false);
  });

  it("requires backups exactly for non-SkillKeep-owned affected paths", () => {
    expect(createPlan(input).backupRequired).toEqual([linkCreate.path]);
  });
});

describe("isPlanStale", () => {
  const plan = createPlan({
    preconditions: [{ key: "manifest:global", value: "sha256:aaa" }],
    operations: [linkCreate],
    ownership: [],
    postConditions: [],
  });

  it("is fresh when every precondition still holds", () => {
    expect(
      isPlanStale(plan, [
        { key: "manifest:global", value: "sha256:aaa" },
        { key: "unrelated", value: "x" },
      ]),
    ).toBe(false);
  });

  it("is stale when an observed value changed", () => {
    expect(isPlanStale(plan, [{ key: "manifest:global", value: "sha256:bbb" }])).toBe(true);
  });

  it("is stale when a precondition can no longer be observed", () => {
    expect(isPlanStale(plan, [{ key: "other", value: "1" }])).toBe(true);
  });
});
