import { describe, expect, it } from "vitest";
import { isPlanStale } from "./plan.js";
import {
  encodeInspection,
  planLinkSkill,
  planUnlinkSkill,
} from "./link-planner.js";

const entry = {
  id: "web2md",
  contentHash: "sha256:" + "ab".repeat(32),
  vaultPath: "C:/Users/dev/.skillvault/vault/web2md/abababababab",
  name: "web2md",
  description: "d",
};

const linkPath = "C:/Users/dev/.config/opencode/skills/web2md";
const installationId = "opencode:global";

describe("planLinkSkill", () => {
  it("plans a single link-create when the target path is free", () => {
    const result = planLinkSkill({
      entry,
      installationId,
      target: { path: linkPath, inspection: { kind: "missing" }, ownership: "skillvault-owned" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.operations).toEqual([
      {
        kind: "link-create",
        installationId,
        path: linkPath,
        targetPath: entry.vaultPath,
      },
    ]);
    expect(result.plan.backupRequired).toEqual([]);
    expect(result.plan.reversible).toBe(true);
    expect(result.noop).toBe(false);
  });

  it("evacuates unmanaged content to a backup before linking", () => {
    const result = planLinkSkill({
      entry,
      installationId,
      target: { path: linkPath, inspection: { kind: "directory" }, ownership: "user-owned" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.operations.map((o) => o.kind)).toEqual([
      "backup",
      "link-create",
    ]);
    expect(result.plan.backupRequired).toEqual([linkPath]);
    expect(result.plan.reversible).toBe(true);
  });

  it("treats unknown ownership like unmanaged content (backup first)", () => {
    const result = planLinkSkill({
      entry,
      installationId,
      target: { path: linkPath, inspection: { kind: "directory" }, ownership: "unknown" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.operations.map((o) => o.kind)).toEqual([
        "backup",
        "link-create",
      ]);
    }
  });

  it("returns a no-op plan when the junction already points at the right revision", () => {
    const result = planLinkSkill({
      entry,
      installationId,
      target: {
        path: linkPath,
        inspection: { kind: "junction", target: entry.vaultPath, targetExists: true },
        ownership: "skillvault-owned",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.operations).toEqual([]);
      expect(result.noop).toBe(true);
    }
  });

  it("replans a junction pointing elsewhere as remove + create without backup", () => {
    const stale = "C:/Users/dev/.skillvault/vault/web2md/000000000000";
    const result = planLinkSkill({
      entry,
      installationId,
      target: {
        path: linkPath,
        inspection: { kind: "junction", target: stale, targetExists: true },
        ownership: "skillvault-owned",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.operations).toEqual([
      { kind: "link-remove", installationId, path: linkPath, targetPath: stale },
      { kind: "link-create", installationId, path: linkPath, targetPath: entry.vaultPath },
    ]);
    expect(result.plan.backupRequired).toEqual([]);
  });

  it("refuses a file in the way", () => {
    const result = planLinkSkill({
      entry,
      installationId,
      target: { path: linkPath, inspection: { kind: "file" }, ownership: "unknown" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("plan/unsupported-target");
  });

  it("records preconditions that make the plan stale when reality changes", () => {
    const result = planLinkSkill({
      entry,
      installationId,
      target: { path: linkPath, inspection: { kind: "missing" }, ownership: "skillvault-owned" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const fresh = [
      { key: `inspect:${linkPath}`, value: encodeInspection({ kind: "missing" }) },
      { key: `vault:${entry.id}`, value: entry.contentHash },
    ];
    expect(isPlanStale(result.plan, fresh)).toBe(false);

    const drifted = [
      { key: `inspect:${linkPath}`, value: encodeInspection({ kind: "directory" }) },
      { key: `vault:${entry.id}`, value: entry.contentHash },
    ];
    expect(isPlanStale(result.plan, drifted)).toBe(true);
  });

  it("produces identical plan ids for identical inputs", () => {
    const make = () =>
      planLinkSkill({
        entry,
        installationId,
        target: { path: linkPath, inspection: { kind: "missing" }, ownership: "skillvault-owned" },
      });
    const a = make();
    const b = make();
    expect(a.ok && b.ok && a.plan.id === b.plan.id).toBe(true);
  });
});

describe("planUnlinkSkill", () => {
  it("plans a single link-remove for a managed junction", () => {
    const result = planUnlinkSkill({
      installationId,
      target: {
        path: linkPath,
        inspection: { kind: "junction", target: entry.vaultPath, targetExists: true },
        ownership: "skillvault-owned",
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.plan.operations).toEqual([
        {
          kind: "link-remove",
          installationId,
          path: linkPath,
          targetPath: entry.vaultPath,
        },
      ]);
      expect(result.plan.reversible).toBe(true);
    }
  });

  it("refuses to unlink a real directory (that is uninstall, not unlink)", () => {
    const result = planUnlinkSkill({
      installationId,
      target: { path: linkPath, inspection: { kind: "directory" }, ownership: "user-owned" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("plan/not-managed");
  });

  it("returns a no-op when nothing exists at the path", () => {
    const result = planUnlinkSkill({
      installationId,
      target: { path: linkPath, inspection: { kind: "missing" }, ownership: "skillvault-owned" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.noop).toBe(true);
  });
});
