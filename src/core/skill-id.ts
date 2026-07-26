/**
 * Canonical skill ID normalization (ARCHITECTURE.md, "Desired-state resolution").
 *
 * A canonical skill ID is lowercase kebab-case. Normalization can identify a
 * collision candidate, but it never merges two skills automatically.
 */

export interface SkillIdError {
  readonly code: "skill-id/empty";
  readonly input: string;
  readonly message: string;
}

export type NormalizeResult =
  | { readonly ok: true; readonly id: string }
  | { readonly ok: false; readonly error: SkillIdError };

export function normalizeSkillId(input: string): NormalizeResult {
  const id = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (id === "") {
    return {
      ok: false,
      error: {
        code: "skill-id/empty",
        input,
        message: `Skill ID ${JSON.stringify(input)} normalizes to an empty string.`,
      },
    };
  }

  return { ok: true, id };
}

export interface SkillIdCollision {
  readonly id: string;
  /** The distinct raw inputs that normalize to `id`, sorted for determinism. */
  readonly inputs: readonly string[];
}

/**
 * Reports canonical IDs claimed by more than one distinct raw input. Exact
 * duplicates of the same raw string are not collisions; unnormalizable inputs
 * are skipped (they surface through normalizeSkillId at validation time).
 * Output is sorted by canonical ID so results are order-independent.
 */
export function findCollisions(rawIds: readonly string[]): SkillIdCollision[] {
  const byId = new Map<string, string[]>();
  for (const raw of rawIds) {
    const result = normalizeSkillId(raw);
    if (!result.ok) continue;
    const inputs = byId.get(result.id) ?? [];
    if (!inputs.includes(raw)) inputs.push(raw);
    byId.set(result.id, inputs);
  }

  return [...byId.entries()]
    .filter(([, inputs]) => inputs.length > 1)
    .map(([id, inputs]) => ({ id, inputs: [...inputs].sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
