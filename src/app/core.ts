import path from "node:path";
import { discoverSkills as discoverAntigravitySkills } from "../adapters/antigravity.js";
import { discoverSkills as discoverOpencodeSkills } from "../adapters/opencode.js";
import {
  LOCATION_KEYS_ORDERED,
  type DiscoveredSkill,
  type LocationKey as SkillLocation,
} from "../adapters/types.js";
import { readDeclaredBundles } from "../installers/lockfiles.js";
import { loadUserAssertions, saveUserAssertion } from "../provenance/store.js";
import { planLinkSkill } from "../core/link-planner.js";
import { createPlan, type Plan, type PlanInput, type Precondition } from "../core/plan.js";
import { hashDirectory } from "../fs/hash.js";
import { inspectPath } from "../fs/junction.js";
import { applyPlan } from "../transaction/executor.js";
import { findInterrupted, type JournalEntry } from "../transaction/journal.js";
import { ingestLocalSkill } from "../vault/ingest.js";

/**
 * Skill-first TuiCore facade (docs/TUI_FLOW.md): one row per canonical skill
 * ID aggregating every physical location, a lazy content-conflict check, and
 * consolidated multi-location manage plans. This module owns the
 * ~/.skillvault layout and all path derivation; the TUI never computes a
 * path.
 */

export type Health = "managed" | "external" | "broken" | "unmanaged";

export type LocationKey = SkillLocation;

export interface SkillLocationView {
  readonly key: LocationKey;
  readonly scope: "global" | "project";
  readonly path: string;
  readonly entryKind: "directory" | "junction";
  readonly health: Health;
}

export interface AggregatedSkillView {
  readonly id: string;
  readonly health: Health;
  readonly locations: readonly SkillLocationView[];
  readonly targets: Readonly<Record<LocationKey, boolean>>;
  /**
   * Source-repository label (e.g. "obra/superpowers"). Comes from a user
   * assertion (user-verified) or an installer lockfile (Declared) — never a
   * name-based guess (TUI_FLOW.md, "bundle grouping"). Absent when no
   * evidence exists; the TUI renders that as "(unknown source)".
   */
  readonly bundle?: string;
  /** Confidence behind the bundle label. */
  readonly bundleConfidence?: "user-verified" | "declared";
}

export type ContentCheck =
  | { readonly identical: true }
  | {
      readonly identical: false;
      readonly options: readonly {
        readonly key: LocationKey;
        readonly path: string;
        readonly hashShort: string;
      }[];
    };

export interface CreatableTarget {
  readonly key: LocationKey;
  readonly path: string;
}

export interface ManageRequest {
  readonly id: string;
  /** Existing locations to convert into managed junctions. */
  readonly paths: readonly string[];
  /** Targets where the skill does not exist yet and a link is created. */
  readonly createKeys?: readonly LocationKey[];
  /** Required when the copies differ in content. */
  readonly canonicalPath?: string;
}

export type ManageOutcome =
  | { readonly ok: true; readonly plan: Plan; readonly noop: boolean }
  | { readonly ok: false; readonly code: "conflict"; readonly options: Extract<ContentCheck, { identical: false }>["options"] }
  | { readonly ok: false; readonly code: "error"; readonly message: string };

export interface ApplyOutcome {
  readonly ok: boolean;
  readonly message: string;
}

export interface TuiCore {
  loadInventory(): AggregatedSkillView[];
  checkContent(id: string): ContentCheck;
  creatableTargets(id: string): CreatableTarget[];
  buildManagePlan(request: ManageRequest): ManageOutcome;
  applyPlan(plan: Plan): ApplyOutcome;
  /**
   * Transactions that crashed mid-run or failed with an incomplete
   * rollback (persistent journal under ~/.skillvault/state). The TUI
   * surfaces these as a recovery notice; backups are always preserved.
   */
  interruptedTransactions(): JournalEntry[];
  /**
   * Records a user-asserted source repository for a skill (M6 editable
   * provenance, persisted under ~/.skillvault/state/provenance.json).
   * Accepts "owner/repo" or a full URL; enters the model as user-verified.
   */
  assignSource(
    id: string,
    repository: string,
  ): { readonly ok: true } | { readonly ok: false; readonly message: string };
}

export interface FacadeEnvironment {
  readonly homeDir: string;
  readonly projectDir?: string;
}

const HEALTH_SEVERITY: Record<Health, number> = {
  broken: 3,
  unmanaged: 2,
  external: 1,
  managed: 0,
};

const LOCATION_KEYS: readonly LocationKey[] = LOCATION_KEYS_ORDERED;

export function createTuiCore(env: FacadeEnvironment): TuiCore {
  const skillvaultRoot = path.join(env.homeDir, ".skillvault");
  const vaultRoot = path.join(skillvaultRoot, "vault");
  const backupsRoot = path.join(skillvaultRoot, "backups");
  const locksRoot = path.join(skillvaultRoot, "locks");
  const stateRoot = path.join(skillvaultRoot, "state");
  const factsByPlan = new Map<string, readonly Precondition[]>();

  const discoveryEnv = {
    homeDir: env.homeDir,
    ...(env.projectDir !== undefined ? { projectDir: env.projectDir } : {}),
  };

  const locationHealth = (skill: DiscoveredSkill): Health =>
    skill.dangling
      ? "broken"
      : skill.entryKind === "junction"
        ? skill.junctionTarget?.startsWith(vaultRoot)
          ? "managed"
          : "external"
        : "unmanaged";

  const loadInventory = (): AggregatedSkillView[] => {
    // Installer lockfiles are re-read on every load: an `npx skills` run in
    // another terminal must show up on the next inventory refresh. Multiple
    // lockfiles may declare the same skill; the first in priority order
    // (agents store, then Antigravity variants) labels the bundle. A user
    // assertion (editable provenance) outranks installer declarations.
    const { declared } = readDeclaredBundles({ homeDir: env.homeDir });
    const { assertions } = loadUserAssertions(stateRoot);
    const byId = new Map<string, SkillLocationView[]>();
    const discovered = [
      ...discoverOpencodeSkills(discoveryEnv),
      ...discoverAntigravitySkills({ homeDir: env.homeDir }),
    ];
    for (const skill of discovered) {
      const view: SkillLocationView = {
        key: skill.location,
        scope: skill.scope,
        path: skill.path,
        entryKind: skill.entryKind,
        health: locationHealth(skill),
      };
      const list = byId.get(skill.id) ?? [];
      list.push(view);
      byId.set(skill.id, list);
    }

    return [...byId.entries()]
      .map(([id, locations]) => {
        const health = locations.reduce<Health>(
          (worst, location) =>
            HEALTH_SEVERITY[location.health] > HEALTH_SEVERITY[worst]
              ? location.health
              : worst,
          "managed",
        );
        const targets = Object.fromEntries(
          LOCATION_KEYS.map((key) => [
            key,
            locations.some((location) => location.key === key),
          ]),
        ) as Record<LocationKey, boolean>;
        const asserted = assertions.get(id);
        const declaredBundle = declared.get(id)?.[0]?.bundle;
        const bundle = asserted?.repository ?? declaredBundle;
        const bundleConfidence =
          asserted !== undefined
            ? ("user-verified" as const)
            : declaredBundle !== undefined
              ? ("declared" as const)
              : undefined;
        return {
          id,
          health,
          locations,
          targets,
          ...(bundle !== undefined ? { bundle } : {}),
          ...(bundleConfidence !== undefined ? { bundleConfidence } : {}),
        };
      })
      .sort(
        (a, b) =>
          HEALTH_SEVERITY[b.health] - HEALTH_SEVERITY[a.health] ||
          a.id.localeCompare(b.id),
      );
  };

  const findSkill = (id: string): AggregatedSkillView | undefined =>
    loadInventory().find((row) => row.id === id);

  const checkContent = (id: string): ContentCheck => {
    const skill = findSkill(id);
    if (!skill) return { identical: true };

    const options = skill.locations
      .filter((location) => location.health !== "broken")
      .map((location) => {
        const hash = hashDirectory(location.path);
        return {
          key: location.key,
          path: location.path,
          hashShort: hash.ok ? hash.hash.slice(7, 19) : "unreadable",
        };
      });
    const distinct = new Set(options.map((option) => option.hashShort));
    return distinct.size <= 1
      ? { identical: true }
      : { identical: false, options };
  };

  const creatableTargets = (id: string): CreatableTarget[] => {
    const skill = findSkill(id);
    if (!skill) return [];
    const creatable: CreatableTarget[] = [];
    if (!skill.targets["opencode"]) {
      creatable.push({
        key: "opencode",
        path: path.join(env.homeDir, ".config", "opencode", "skills", id),
      });
    }
    if (!skill.targets["claude-external"]) {
      creatable.push({
        key: "claude-external",
        path: path.join(env.homeDir, ".claude", "skills", id),
      });
    }
    // agents-external is the npx-skills store; SkillVault never writes into
    // it (ADR-0005). Antigravity variants stay non-creatable until live
    // junction consumption by its loader is verified (M0 pending fact).
    return creatable;
  };

  const buildManagePlan = (request: ManageRequest): ManageOutcome => {
    const skill = findSkill(request.id);
    if (!skill) {
      return {
        ok: false,
        code: "error",
        message: `No discovered skill named "${request.id}".`,
      };
    }

    const check = checkContent(request.id);
    let canonicalPath = request.canonicalPath;
    if (!check.identical && canonicalPath === undefined) {
      return { ok: false, code: "conflict", options: check.options };
    }
    canonicalPath ??=
      skill.locations.find((location) => location.health !== "broken")?.path;
    if (canonicalPath === undefined) {
      return {
        ok: false,
        code: "error",
        message: `No readable copy of "${request.id}" exists to ingest.`,
      };
    }

    const ingested = ingestLocalSkill({
      sourceDir: canonicalPath,
      vaultRoot,
      id: request.id,
    });
    if (!ingested.ok) {
      const causes = ingested.error.causes
        .map((cause) => cause.message)
        .join("; ");
      return {
        ok: false,
        code: "error",
        message: `${ingested.error.message}${causes ? ` (${causes})` : ""}`,
      };
    }

    const creatable = creatableTargets(request.id);
    const linkTargets: { path: string; installationId: string }[] = [
      ...request.paths.map((p) => ({ path: p, installationId: "opencode:global" })),
      ...(request.createKeys ?? []).flatMap((key) => {
        const target = creatable.find((t) => t.key === key);
        return target
          ? [{ path: target.path, installationId: `${key}:global` }]
          : [];
      }),
    ];

    const combined: PlanInput = {
      preconditions: [],
      operations: [],
      ownership: [],
      postConditions: [],
    };
    const preconditions = new Map<string, string>();
    const operations: PlanInput["operations"][number][] = [];
    const ownership: PlanInput["ownership"][number][] = [];
    const postConditions: string[] = [];

    for (const target of linkTargets) {
      const inspection = inspectPath(target.path);
      const built = planLinkSkill({
        entry: ingested.entry,
        installationId: target.installationId,
        target: {
          path: target.path,
          inspection,
          ownership:
            inspection.kind === "junction" ? "skillvault-owned" : "user-owned",
        },
      });
      if (!built.ok) {
        return { ok: false, code: "error", message: built.error.message };
      }
      for (const p of built.plan.preconditions) preconditions.set(p.key, p.value);
      operations.push(...built.plan.operations);
      ownership.push(...built.plan.ownership);
      postConditions.push(...built.plan.postConditions);
    }

    const plan = createPlan({
      ...combined,
      preconditions: [...preconditions.entries()].map(([key, value]) => ({
        key,
        value,
      })),
      operations,
      ownership,
      postConditions,
    });
    factsByPlan.set(plan.id, [
      { key: `vault:${ingested.entry.id}`, value: ingested.entry.contentHash },
    ]);
    return { ok: true, plan, noop: operations.length === 0 };
  };

  const apply = (plan: Plan): ApplyOutcome => {
    const result = applyPlan(plan, {
      backupsRoot,
      locksRoot,
      stateRoot,
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

  const assignSource: TuiCore["assignSource"] = (id, repository) => {
    // Normalize a pasted GitHub URL down to "owner/repo"; anything else is
    // stored as typed (trimmed). Empty input is a user error, not a clear.
    const normalized = repository
      .trim()
      .replace(/^https?:\/\/(www\.)?github\.com\//i, "")
      .replace(/\.git$/i, "")
      .replace(/^\/+|\/+$/g, "");
    if (normalized === "") {
      return { ok: false, message: "Source repository must not be empty." };
    }
    saveUserAssertion(stateRoot, id, {
      repository: normalized,
      assertedAt: new Date().toISOString(),
    });
    return { ok: true };
  };

  return {
    loadInventory,
    checkContent,
    creatableTargets,
    buildManagePlan,
    applyPlan: apply,
    interruptedTransactions: () => findInterrupted(stateRoot),
    assignSource,
  };
}
