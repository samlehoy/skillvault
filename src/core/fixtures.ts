import type { ActualState } from "./actual.js";

/**
 * Shared M1 fixtures: multiple projects, installations, scope overrides,
 * collisions, and invalid inputs (IMPLEMENTATION_PLAN.md, Milestone 1).
 * Fixtures are plain data so every core module can exercise the same
 * realistic shapes without touching the filesystem.
 */

export const globalManifestData = {
  schema: 1,
  skills: {
    "code-review": {
      source: { type: "local", path: "C:/skills/code-review" },
    },
    "web2md": {
      source: {
        type: "git",
        repository: "https://github.com/acme/skills.git",
        subdir: "web2md",
        ref: "main",
      },
    },
    "release-notes": {
      source: { type: "local", path: "C:/skills/release-notes" },
    },
  },
} as const;

/** Overrides web2md with a pinned fork and disables release-notes. */
export const projectAManifestData = {
  schema: 1,
  skills: {
    "web2md": {
      source: {
        type: "git",
        repository: "https://github.com/acme-fork/skills.git",
        subdir: "web2md",
        ref: "v2",
      },
    },
    "release-notes": { disabled: true },
    "sql-review": {
      source: { type: "local", path: "C:/work/a/skills/sql-review" },
      targets: ["opencode-proj-a"],
    },
  },
} as const;

/** Declares nothing of its own except a disable without a global entry. */
export const projectBManifestData = {
  schema: 1,
  skills: {
    "nonexistent": { disabled: true },
  },
} as const;

export const actualStateFixture: ActualState = {
  installations: [
    {
      id: "opencode-global",
      agent: "opencode",
      scope: "global",
      root: "C:/Users/dev/.config/opencode/skills",
    },
    {
      id: "opencode-proj-a",
      agent: "opencode",
      scope: "project",
      root: "C:/work/a/.opencode/skills",
    },
    {
      id: "claude-code-global",
      agent: "claude-code",
      scope: "global",
      root: "C:/Users/dev/.claude/skills",
    },
  ],
  targets: [
    {
      installationId: "opencode-global",
      skillId: "code-review",
      path: "C:/Users/dev/.config/opencode/skills/code-review",
      linkState: "linked",
      ownership: "skillkeep-owned",
    },
    {
      installationId: "opencode-proj-a",
      skillId: "web2md",
      path: "C:/work/a/.opencode/skills/web2md",
      linkState: "divergent",
      ownership: "user-owned",
    },
    {
      installationId: "claude-code-global",
      skillId: undefined,
      path: "C:/Users/dev/.claude/skills/handwritten",
      linkState: "unmanaged",
      ownership: "unknown",
    },
  ],
};

/** Raw inputs whose normalized IDs collide pairwise. */
export const collidingRawIds = [
  "Code Review",
  "code_review",
  "code-review",
  "web2md",
] as const;

export interface InvalidManifestFixture {
  readonly name: string;
  readonly data: unknown;
  readonly expectedCode: string;
}

export const invalidManifestFixtures: readonly InvalidManifestFixture[] = [
  {
    name: "not an object",
    data: ["schema", 1],
    expectedCode: "manifest/not-object",
  },
  {
    name: "future schema version",
    data: { schema: 2, skills: {} },
    expectedCode: "manifest/unsupported-schema",
  },
  {
    name: "non-canonical skill id",
    data: {
      schema: 1,
      skills: {
        "Code Review": { source: { type: "local", path: "C:/x" } },
      },
    },
    expectedCode: "manifest/invalid-id",
  },
  {
    name: "unknown source type",
    data: {
      schema: 1,
      skills: { "code-review": { source: { type: "npm", name: "x" } } },
    },
    expectedCode: "manifest/invalid",
  },
  {
    name: "disable with extra keys",
    data: {
      schema: 1,
      skills: { "code-review": { disabled: true, source: null } },
    },
    expectedCode: "manifest/invalid",
  },
];
