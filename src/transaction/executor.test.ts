import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodeInspection, planLinkSkill } from "../core/link-planner.js";
import { createPlan, type Precondition } from "../core/plan.js";
import { hashDirectory } from "../fs/hash.js";
import { inspectPath } from "../fs/junction.js";
import { applyPlan } from "./executor.js";

let root: string;
let backupsRoot: string;
let locksRoot: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-tx-"));
  backupsRoot = path.join(root, "backups");
  locksRoot = path.join(root, "locks");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const makeDir = (rel: string, marker = "content"): string => {
  const dir = path.join(root, rel);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `# ${marker}\n`);
  return dir;
};

const entryFor = (vaultPath: string, id = "web2md") => ({
  id,
  contentHash: (() => {
    const h = hashDirectory(vaultPath);
    return h.ok ? h.hash : "sha256:unknown";
  })(),
  vaultPath,
  name: id,
  description: "d",
});

const env = () => ({ backupsRoot, locksRoot });

const linkPlanFor = (vaultPath: string, linkPath: string) => {
  const entry = entryFor(vaultPath);
  const built = planLinkSkill({
    entry,
    installationId: "opencode:global",
    target: {
      path: linkPath,
      inspection: inspectPath(linkPath),
      ownership: "skillvault-owned",
    },
  });
  if (!built.ok) throw new Error("plan build failed");
  return {
    plan: built.plan,
    extraFacts: [
      { key: `vault:${entry.id}`, value: entry.contentHash },
    ] as Precondition[],
  };
};

describe("applyPlan", () => {
  it("applies a link-create plan end to end", () => {
    const vault = makeDir("vault/web2md/aaa");
    const link = path.join(root, "target", "web2md");
    const { plan, extraFacts } = linkPlanFor(vault, link);

    const result = applyPlan(plan, { ...env(), extraFacts });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.applied).toHaveLength(1);
      expect(result.record.rolledBack).toBe(false);
    }
    const inspection = inspectPath(link);
    expect(inspection.kind).toBe("junction");
    if (inspection.kind === "junction") {
      expect(path.resolve(inspection.target)).toBe(path.resolve(vault));
    }
  });

  it("rejects a stale plan without executing anything", () => {
    const vault = makeDir("vault/web2md/aaa");
    const link = path.join(root, "target", "web2md");
    const { plan, extraFacts } = linkPlanFor(vault, link);

    makeDir("target/web2md", "surprise");

    const result = applyPlan(plan, { ...env(), extraFacts });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("transaction/stale");
      expect(result.record.applied).toHaveLength(0);
    }
    expect(inspectPath(link).kind).toBe("directory");
  });

  it("holds an exclusive lock and releases it afterwards", () => {
    const vault = makeDir("vault/web2md/aaa");
    const linkA = path.join(root, "target", "a");
    const linkB = path.join(root, "target", "b");

    fs.mkdirSync(locksRoot, { recursive: true });
    fs.writeFileSync(path.join(locksRoot, "mutation.lock"), "held");
    const first = linkPlanFor(vault, linkA);
    const blocked = applyPlan(first.plan, { ...env(), extraFacts: first.extraFacts });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("transaction/locked");

    fs.rmSync(path.join(locksRoot, "mutation.lock"));
    const second = linkPlanFor(vault, linkB);
    const allowed = applyPlan(second.plan, { ...env(), extraFacts: second.extraFacts });
    expect(allowed.ok).toBe(true);
    expect(fs.existsSync(path.join(locksRoot, "mutation.lock"))).toBe(false);
  });

  it("evacuates unmanaged content to backup storage before linking", () => {
    const vault = makeDir("vault/web2md/aaa", "canonical");
    const link = path.join(root, "target", "web2md");
    makeDir("target/web2md", "precious-user-content");
    const before = hashDirectory(link);

    const { plan, extraFacts } = linkPlanFor(vault, link);
    const result = applyPlan(plan, { ...env(), extraFacts });
    expect(result.ok).toBe(true);

    expect(inspectPath(link).kind).toBe("junction");
    const backupOp = plan.operations.find((o) => o.kind === "backup");
    expect(backupOp).toBeDefined();
    if (backupOp?.kind === "backup") {
      const backupPath = path.join(backupsRoot, backupOp.backupId);
      const backedUp = hashDirectory(backupPath);
      expect(before.ok && backedUp.ok && backedUp.hash === before.hash).toBe(true);
    }
  });

  it("rolls back applied operations when a later operation fails", () => {
    const vault = makeDir("vault/web2md/aaa");
    const linkA = path.join(root, "target", "a");
    const linkB = path.join(root, "target", "b");

    const plan = createPlan({
      preconditions: [
        { key: `inspect:${linkA}`, value: encodeInspection(inspectPath(linkA)) },
      ],
      operations: [
        { kind: "link-create", installationId: "x", path: linkA, targetPath: vault },
        { kind: "link-create", installationId: "x", path: linkB, targetPath: path.join(root, "ghost") },
      ],
      ownership: [],
      postConditions: [],
    });

    const result = applyPlan(plan, env());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("transaction/operation-failed");
      expect(result.record.rolledBack).toBe(true);
      expect(result.record.rollbackErrors).toEqual([]);
    }
    expect(inspectPath(linkA).kind).toBe("missing");
    expect(inspectPath(linkB).kind).toBe("missing");
  });

  it("restores evacuated content when rollback follows a backup", () => {
    const vault = makeDir("vault/web2md/aaa", "canonical");
    const link = path.join(root, "target", "web2md");
    makeDir("target/web2md", "precious");
    const before = hashDirectory(link);

    const backupId = "bak-test";
    const plan = createPlan({
      preconditions: [
        { key: `inspect:${link}`, value: encodeInspection(inspectPath(link)) },
      ],
      operations: [
        { kind: "backup", sourcePath: link, backupId },
        { kind: "link-create", installationId: "x", path: link, targetPath: path.join(root, "ghost") },
      ],
      ownership: [{ path: link, ownership: "user-owned" }],
      postConditions: [],
    });

    const result = applyPlan(plan, env());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.record.rolledBack).toBe(true);

    const after = hashDirectory(link);
    expect(before.ok && after.ok && after.hash === before.hash).toBe(true);
    expect(fs.existsSync(path.join(backupsRoot, backupId))).toBe(false);
  });

  it("refuses link-remove when the junction points somewhere unexpected", () => {
    const vault = makeDir("vault/web2md/aaa");
    const other = makeDir("vault/other/bbb");
    const link = path.join(root, "target", "web2md");
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(other, link, "junction");

    const plan = createPlan({
      preconditions: [],
      operations: [
        { kind: "link-remove", installationId: "x", path: link, targetPath: vault },
      ],
      ownership: [],
      postConditions: [],
    });

    const result = applyPlan(plan, env());
    expect(result.ok).toBe(false);
    expect(inspectPath(link).kind).toBe("junction");
  });

  it("applies a no-op plan trivially", () => {
    const plan = createPlan({
      preconditions: [],
      operations: [],
      ownership: [],
      postConditions: [],
    });
    const result = applyPlan(plan, env());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record.applied).toHaveLength(0);
  });

  it("refuses plans containing operations this executor does not support", () => {
    const plan = createPlan({
      preconditions: [],
      operations: [
        { kind: "vault-stage", skillId: "x", contentHash: "sha256:x" },
      ],
      ownership: [],
      postConditions: [],
    });
    const result = applyPlan(plan, env());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("transaction/unsupported-operation");
  });
});
