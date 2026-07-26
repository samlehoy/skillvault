import type { Manifest, SkillDeclaration } from "./manifest.js";

/**
 * Desired-state resolution (ARCHITECTURE.md):
 *
 *   effective(project) = global + project overrides - project disables
 *
 * Pure data-in/data-out: no filesystem, no TUI state. Output ordering is
 * canonical (sorted by ID) so identical inputs always produce identical
 * results regardless of declaration order.
 */

export interface EffectiveSkill {
  readonly id: string;
  readonly declaration: SkillDeclaration;
  readonly scope: "global" | "project";
  readonly overridesGlobal: boolean;
}

export interface ResolutionFinding {
  readonly code:
    | "resolve/project-shadowing"
    | "resolve/disable-without-global"
    | "resolve/disable-in-global";
  readonly id: string;
  readonly message: string;
}

export interface Resolution {
  readonly skills: readonly EffectiveSkill[];
  readonly findings: readonly ResolutionFinding[];
}

const isDisable = (entry: Manifest["skills"][string]) => "disabled" in entry;

export function resolveEffective(
  global: Manifest,
  project?: Manifest,
): Resolution {
  const effective = new Map<string, EffectiveSkill>();
  const findings: ResolutionFinding[] = [];

  for (const [id, entry] of Object.entries(global.skills)) {
    if (isDisable(entry)) {
      findings.push({
        code: "resolve/disable-in-global",
        id,
        message: `Global manifest disables "${id}"; disabling is a project-scope concept and the entry is ignored.`,
      });
      continue;
    }
    effective.set(id, {
      id,
      declaration: entry,
      scope: "global",
      overridesGlobal: false,
    });
  }

  for (const [id, entry] of Object.entries(project?.skills ?? {})) {
    if (isDisable(entry)) {
      if (effective.has(id)) {
        effective.delete(id);
      } else {
        findings.push({
          code: "resolve/disable-without-global",
          id,
          message: `Project disables "${id}", but no global declaration exists; the entry has no effect.`,
        });
      }
      continue;
    }
    const overridesGlobal = effective.has(id);
    if (overridesGlobal) {
      findings.push({
        code: "resolve/project-shadowing",
        id,
        message: `Project declaration shadows the global declaration for "${id}".`,
      });
    }
    effective.set(id, {
      id,
      declaration: entry,
      scope: "project",
      overridesGlobal,
    });
  }

  return {
    skills: [...effective.values()].sort((a, b) => a.id.localeCompare(b.id)),
    findings: findings.sort(
      (a, b) => a.id.localeCompare(b.id) || a.code.localeCompare(b.code),
    ),
  };
}
