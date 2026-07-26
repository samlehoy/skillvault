import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlan, type Operation } from "../core/plan.js";
import { applyPlan } from "./executor.js";
import {
  findInterrupted,
  journalPathFor,
  writeJournalEntry,
  type JournalEntry,
} from "./journal.js";

let stateRoot: string;

beforeEach(() => {
  stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-journal-"));
});

afterEach(() => {
  fs.rmSync(stateRoot, { recursive: true, force: true });
});

const op: Operation = {
  kind: "link-create",
  installationId: "opencode:global",
  path: "C:/skills/x",
  targetPath: "C:/vault/x/abc",
};

const entry = (overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  planId: "plan-abc123",
  status: "in-progress",
  operations: [op],
  applied: [],
  rollbackErrors: [],
  startedAt: "2026-07-27T00:00:00.000Z",
  ...overrides,
});

describe("journal persistence", () => {
  it("writes and overwrites one JSON file per plan", () => {
    writeJournalEntry(stateRoot, entry());
    const filePath = journalPathFor(stateRoot, "plan-abc123");
    expect(fs.existsSync(filePath)).toBe(true);

    writeJournalEntry(
      stateRoot,
      entry({ status: "applied", applied: [op], finishedAt: "2026-07-27T00:00:01.000Z" }),
    );
    const stored = JSON.parse(fs.readFileSync(filePath, "utf8")) as JournalEntry;
    expect(stored.status).toBe("applied");
    expect(stored.applied).toHaveLength(1);
  });

  it("finds in-progress and rollback-failed entries as interrupted", () => {
    writeJournalEntry(stateRoot, entry({ planId: "plan-crashed" }));
    writeJournalEntry(
      stateRoot,
      entry({ planId: "plan-ok", status: "applied", applied: [op] }),
    );
    writeJournalEntry(
      stateRoot,
      entry({
        planId: "plan-bad-rollback",
        status: "rollback-failed",
        rollbackErrors: ["could not restore"],
      }),
    );
    writeJournalEntry(
      stateRoot,
      entry({ planId: "plan-rolled", status: "rolled-back" }),
    );

    const interrupted = findInterrupted(stateRoot);
    expect(interrupted.map((e) => e.planId).sort()).toEqual([
      "plan-bad-rollback",
      "plan-crashed",
    ]);
  });

  it("returns nothing for an absent state directory", () => {
    expect(findInterrupted(path.join(stateRoot, "nope"))).toEqual([]);
  });

  it("persists applied and rolled-back outcomes from the executor", () => {
    const vaultContent = path.join(stateRoot, "vault-content");
    fs.mkdirSync(vaultContent, { recursive: true });
    fs.writeFileSync(path.join(vaultContent, "SKILL.md"), "x", "utf8");
    const linkPath = path.join(stateRoot, "targets", "good");
    fs.mkdirSync(path.dirname(linkPath), { recursive: true });

    const env = {
      backupsRoot: path.join(stateRoot, "backups"),
      locksRoot: path.join(stateRoot, "locks"),
      stateRoot,
    };

    const good = createPlan({
      preconditions: [],
      operations: [
        {
          kind: "link-create",
          installationId: "opencode:global",
          path: linkPath,
          targetPath: vaultContent,
        },
      ],
      ownership: [{ path: linkPath, ownership: "user-owned" }],
      postConditions: [],
    });
    expect(applyPlan(good, env).ok).toBe(true);
    const goodEntry = JSON.parse(
      fs.readFileSync(journalPathFor(stateRoot, good.id), "utf8"),
    ) as JournalEntry;
    expect(goodEntry.status).toBe("applied");
    expect(goodEntry.applied).toHaveLength(1);
    expect(goodEntry.finishedAt).toBeDefined();

    // A link-create to a missing vault path fails post-verification and
    // rolls back; the journal must record that terminal state.
    const bad = createPlan({
      preconditions: [],
      operations: [
        {
          kind: "link-create",
          installationId: "opencode:global",
          path: path.join(stateRoot, "targets", "bad"),
          targetPath: path.join(stateRoot, "missing-vault"),
        },
      ],
      ownership: [],
      postConditions: [],
    });
    const failedResult = applyPlan(bad, env);
    expect(failedResult.ok).toBe(false);
    const badEntry = JSON.parse(
      fs.readFileSync(journalPathFor(stateRoot, bad.id), "utf8"),
    ) as JournalEntry;
    expect(badEntry.status).toBe("rolled-back");

    // Neither terminal state counts as interrupted.
    expect(findInterrupted(stateRoot)).toEqual([]);
  });

  it("skips unreadable journal files instead of throwing", () => {
    writeJournalEntry(stateRoot, entry({ planId: "plan-good" }));
    fs.writeFileSync(
      path.join(stateRoot, "transactions", "garbage.json"),
      "{not json",
      "utf8",
    );
    const interrupted = findInterrupted(stateRoot);
    expect(interrupted.map((e) => e.planId)).toEqual(["plan-good"]);
  });
});
