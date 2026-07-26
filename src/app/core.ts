import path from "node:path";
import { discoverSkills } from "../adapters/opencode.js";
import { planLinkSkill } from "../core/link-planner.js";
import type { Plan, Precondition } from "../core/plan.js";
import { inspectPath } from "../fs/junction.js";
import type {
  ApplyOutcome,
  InventoryRow,
  PlanBuildOutcome,
  TuiCore,
} from "../tui/app.js";
import { applyPlan } from "../transaction/executor.js";
import { ingestLocalSkill } from "../vault/ingest.js";

/**
 * The real TuiCore facade: wires OpenCode discovery, vault ingestion, the
 * link planner, and the transaction executor into the typed surface the TUI
 * consumes. This module owns the ~/.skillvault layout; the TUI never sees a
 * path decision.
 *
 * "Manage this skill" (buildLinkPlan) means: ingest the discovered content
 * into the vault (idempotent for identical content), then plan replacing the
 * discovered location with a managed junction — evacuating unmanaged content
 * to backup storage first.
 */

export interface FacadeEnvironment {
  readonly homeDir: string;
  readonly projectDir?: string;
}

export function createTuiCore(env: FacadeEnvironment): TuiCore {
  const skillvaultRoot = path.join(env.homeDir, ".skillvault");
  const vaultRoot = path.join(skillvaultRoot, "vault");
  const backupsRoot = path.join(skillvaultRoot, "backups");
  const locksRoot = path.join(skillvaultRoot, "locks");
  const factsByPlan = new Map<string, readonly Precondition[]>();

  const discoveryEnv = {
    homeDir: env.homeDir,
    ...(env.projectDir !== undefined ? { projectDir: env.projectDir } : {}),
  };

  const loadInventory = (): InventoryRow[] =>
    discoverSkills(discoveryEnv).map((skill) => {
      const health =
        skill.dangling
          ? "dangling"
          : skill.entryKind === "junction"
            ? skill.junctionTarget?.startsWith(vaultRoot)
              ? "ok"
              : "drift"
            : "unmanaged";
      return {
        id: skill.id,
        scope: skill.scope,
        location: skill.location,
        health,
        path: skill.path,
      };
    });

  const buildLinkPlan = (skillId: string): PlanBuildOutcome => {
    const skill = discoverSkills(discoveryEnv).find((s) => s.id === skillId);
    if (!skill) {
      return { ok: false, message: `No discovered skill named "${skillId}".` };
    }

    const ingested = ingestLocalSkill({
      sourceDir: skill.path,
      vaultRoot,
      id: skill.id,
    });
    if (!ingested.ok) {
      const causes = ingested.error.causes
        .map((cause) => cause.message)
        .join("; ");
      return {
        ok: false,
        message: `${ingested.error.message}${causes ? ` (${causes})` : ""}`,
      };
    }

    const inspection = inspectPath(skill.path);
    const built = planLinkSkill({
      entry: ingested.entry,
      installationId: `opencode:${skill.scope}`,
      target: {
        path: skill.path,
        inspection,
        ownership:
          inspection.kind === "junction" ? "skillvault-owned" : "user-owned",
      },
    });
    if (!built.ok) return { ok: false, message: built.error.message };

    factsByPlan.set(built.plan.id, [
      { key: `vault:${ingested.entry.id}`, value: ingested.entry.contentHash },
    ]);
    return built;
  };

  const apply = (plan: Plan): ApplyOutcome => {
    const result = applyPlan(plan, {
      backupsRoot,
      locksRoot,
      extraFacts: factsByPlan.get(plan.id) ?? [],
    });
    if (result.ok) {
      return {
        ok: true,
        message: `Applied ${result.record.applied.length} operation(s).`,
      };
    }
    const rollback = result.record.rolledBack
      ? result.record.rollbackErrors.length === 0
        ? " All applied operations were rolled back."
        : ` Rollback issues: ${result.record.rollbackErrors.join("; ")}`
      : "";
    return { ok: false, message: `${result.error.message}${rollback}` };
  };

  return { loadInventory, buildLinkPlan, applyPlan: apply };
}
