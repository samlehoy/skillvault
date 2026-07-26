import fs from "node:fs";
import path from "node:path";
import type { UserAssertion } from "./model.js";

/**
 * Persistent user provenance assertions (M6 "editable provenance"):
 * `<stateRoot>/provenance.json`, one entry per skill ID. These enter the
 * confidence model as `user-verified` — the user's word, distinguishable
 * from independent verification.
 *
 * The file is SkillVault-owned but still handled defensively: a corrupt or
 * future-versioned file loads as empty **with a warning**, and the next
 * save preserves the unreadable original as `provenance.json.bak` instead
 * of silently destroying whatever it held.
 */

const SCHEMA = 1;

interface OverridesFile {
  readonly schema: number;
  readonly skills: Record<string, UserAssertion>;
}

export const overridesPathFor = (stateRoot: string): string =>
  path.join(stateRoot, "provenance.json");

export interface LoadedAssertions {
  readonly assertions: ReadonlyMap<string, UserAssertion>;
  readonly warning?: string;
}

function readFile(stateRoot: string): {
  readonly skills: Record<string, UserAssertion>;
  readonly warning?: string;
  readonly unreadable?: boolean;
} {
  const filePath = overridesPathFor(stateRoot);
  if (!fs.existsSync(filePath)) return { skills: {} };
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {
      skills: {},
      warning: `${filePath} is not readable JSON; existing assertions are ignored and will be preserved as .bak on the next change.`,
      unreadable: true,
    };
  }
  const record = data as Partial<OverridesFile> | null;
  if (
    typeof record !== "object" ||
    record === null ||
    record.schema !== SCHEMA ||
    typeof record.skills !== "object" ||
    record.skills === null
  ) {
    return {
      skills: {},
      warning: `${filePath} has an unsupported schema version; this build understands version ${SCHEMA} only.`,
      unreadable: true,
    };
  }
  const skills: Record<string, UserAssertion> = {};
  for (const [id, value] of Object.entries(record.skills)) {
    if (
      typeof value === "object" &&
      value !== null &&
      typeof value.repository === "string" &&
      value.repository !== "" &&
      typeof value.assertedAt === "string"
    ) {
      skills[id] = value;
    }
  }
  return { skills };
}

export function loadUserAssertions(stateRoot: string): LoadedAssertions {
  const { skills, warning } = readFile(stateRoot);
  return {
    assertions: new Map(Object.entries(skills)),
    ...(warning !== undefined ? { warning } : {}),
  };
}

function writeFile(
  stateRoot: string,
  skills: Record<string, UserAssertion>,
  hadUnreadable: boolean,
): void {
  const filePath = overridesPathFor(stateRoot);
  if (hadUnreadable && fs.existsSync(filePath)) {
    fs.copyFileSync(filePath, `${filePath}.bak`);
  }
  const sorted = Object.fromEntries(
    Object.entries(skills).sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({ schema: SCHEMA, skills: sorted }, null, 2)}\n`,
    "utf8",
  );
}

export function saveUserAssertion(
  stateRoot: string,
  skillId: string,
  assertion: UserAssertion,
): void {
  const { skills, unreadable } = readFile(stateRoot);
  skills[skillId] = assertion;
  writeFile(stateRoot, skills, unreadable === true);
}

export function clearUserAssertion(stateRoot: string, skillId: string): void {
  const { skills, unreadable } = readFile(stateRoot);
  delete skills[skillId];
  writeFile(stateRoot, skills, unreadable === true);
}
