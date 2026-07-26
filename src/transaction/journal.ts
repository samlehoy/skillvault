import fs from "node:fs";
import path from "node:path";
import type { Operation } from "../core/plan.js";

/**
 * Persistent transaction journal (clears the recorded M2 debt: transaction
 * records existed only in memory). One JSON file per plan under
 * `<stateRoot>/transactions/`, written when a mutation starts and rewritten
 * as it progresses — so a crash mid-apply leaves an `in-progress` entry
 * behind, which is exactly what recovery detection looks for.
 *
 * Statuses: `in-progress` (running, or crashed mid-run), `applied`
 * (completed), `rolled-back` (failed but fully restored), `rollback-failed`
 * (failed AND rollback reported errors — needs attention; backups are
 * preserved under the backups root).
 */

export interface JournalEntry {
  readonly planId: string;
  readonly status: "in-progress" | "applied" | "rolled-back" | "rollback-failed";
  readonly operations: readonly Operation[];
  readonly applied: readonly Operation[];
  readonly rollbackErrors: readonly string[];
  readonly startedAt: string;
  readonly finishedAt?: string;
}

const TRANSACTIONS_DIR = "transactions";

const safeName = (planId: string): string =>
  planId.replace(/[^a-zA-Z0-9._-]+/g, "_");

export const journalPathFor = (stateRoot: string, planId: string): string =>
  path.join(stateRoot, TRANSACTIONS_DIR, `${safeName(planId)}.json`);

export function writeJournalEntry(stateRoot: string, entry: JournalEntry): void {
  const filePath = journalPathFor(stateRoot, entry.planId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
}

/**
 * Entries that demand user attention: crashed mid-run or failed with an
 * incomplete rollback. Unreadable files are skipped — recovery reporting
 * must never itself crash the app.
 */
export function findInterrupted(stateRoot: string): JournalEntry[] {
  const dir = path.join(stateRoot, TRANSACTIONS_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const interrupted: JournalEntry[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(
        fs.readFileSync(path.join(dir, name), "utf8"),
      ) as JournalEntry;
      if (parsed.status === "in-progress" || parsed.status === "rollback-failed") {
        interrupted.push(parsed);
      }
    } catch {
      // Skip unreadable entries; they are diagnosable with doctor.
    }
  }
  return interrupted;
}
