import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { ParseError } from "./manifest.js";
import { normalizeSkillId } from "./skill-id.js";

/**
 * Canonical SKILL.md validation (ARCHITECTURE.md, "Canonical skill model").
 *
 * The canonical baseline is a directory containing SKILL.md. Frontmatter and
 * directory names are metadata and validation inputs; the manifest-assigned
 * canonical ID stays authoritative, so name mismatches are findings, not
 * errors. SKILL.md is external content, so unknown frontmatter keys are
 * preserved rather than rejected.
 */

export interface SkillMd {
  readonly name: string;
  readonly description: string;
  /** Unknown frontmatter keys, preserved verbatim. */
  readonly extra: Readonly<Record<string, unknown>>;
  readonly body: string;
}

export type SkillMdResult =
  | { readonly ok: true; readonly skill: SkillMd }
  | { readonly ok: false; readonly errors: readonly ParseError[] };

const canonicalName = z
  .string()
  .refine(
    (value) => {
      const result = normalizeSkillId(value);
      return result.ok && result.id === value;
    },
    { message: "must be a canonical lowercase kebab-case skill name" },
  );

const knownFrontmatter = z.looseObject({
  name: canonicalName,
  description: z.string().min(1),
});

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseSkillMd(content: string): SkillMdResult {
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match) {
    return {
      ok: false,
      errors: [
        {
          code: "skill-md/no-frontmatter",
          path: [],
          message:
            "SKILL.md must start with a YAML frontmatter block delimited by --- lines.",
        },
      ],
    };
  }
  const [, rawFrontmatter = "", body = ""] = match;

  let data: unknown;
  try {
    data = parseYaml(rawFrontmatter);
  } catch (error) {
    return {
      ok: false,
      errors: [
        {
          code: "skill-md/invalid-yaml",
          path: [],
          message: `Frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const parsed = knownFrontmatter.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        code: "skill-md/invalid",
        path: issue.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
        message: issue.message,
      })),
    };
  }

  if (body.trim() === "") {
    return {
      ok: false,
      errors: [
        {
          code: "skill-md/empty-body",
          path: [],
          message: "SKILL.md has no instruction body after the frontmatter.",
        },
      ],
    };
  }

  const { name, description, ...extra } = parsed.data;
  return { ok: true, skill: { name, description, extra, body } };
}

export interface AlignmentFinding {
  readonly code: "skill-md/name-mismatch" | "skill-md/directory-mismatch";
  readonly id: string;
  readonly message: string;
}

/**
 * Cross-checks the authoritative canonical ID against frontmatter and
 * directory names. Mismatches are review findings; they never block parsing.
 */
export function checkIdAlignment(
  canonicalId: string,
  observed: { frontmatterName?: string; directoryName?: string },
): AlignmentFinding[] {
  const findings: AlignmentFinding[] = [];
  const { frontmatterName, directoryName } = observed;

  if (frontmatterName !== undefined && frontmatterName !== canonicalId) {
    findings.push({
      code: "skill-md/name-mismatch",
      id: canonicalId,
      message: `Frontmatter name "${frontmatterName}" differs from the canonical ID "${canonicalId}".`,
    });
  }
  if (directoryName !== undefined && directoryName !== canonicalId) {
    findings.push({
      code: "skill-md/directory-mismatch",
      id: canonicalId,
      message: `Directory name "${directoryName}" differs from the canonical ID "${canonicalId}".`,
    });
  }
  return findings;
}
