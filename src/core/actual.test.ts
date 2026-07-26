import { describe, expect, it } from "vitest";
import {
  type ActualState,
  LINK_STATES,
  summarizeLinkStates,
  targetsForSkill,
} from "./actual.js";

const state: ActualState = {
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
  ],
  targets: [
    {
      installationId: "opencode-proj-a",
      skillId: "code-review",
      path: "C:/work/a/.opencode/skills/code-review",
      linkState: "broken",
      ownership: "skillvault-owned",
    },
    {
      installationId: "opencode-global",
      skillId: "code-review",
      path: "C:/Users/dev/.config/opencode/skills/code-review",
      linkState: "linked",
      ownership: "skillvault-owned",
    },
    {
      installationId: "opencode-global",
      skillId: undefined,
      path: "C:/Users/dev/.config/opencode/skills/scratch",
      linkState: "unmanaged",
      ownership: "unknown",
    },
  ],
};

describe("LINK_STATES", () => {
  it("covers the audit categories for link health", () => {
    expect(LINK_STATES).toEqual([
      "linked",
      "missing",
      "broken",
      "redirected",
      "divergent",
      "unmanaged",
    ]);
  });
});

describe("targetsForSkill", () => {
  it("returns only targets for the requested skill", () => {
    const targets = targetsForSkill(state, "code-review");
    expect(targets).toHaveLength(2);
    expect(targets.every((t) => t.skillId === "code-review")).toBe(true);
  });

  it("orders targets canonically by installation then path", () => {
    const targets = targetsForSkill(state, "code-review");
    expect(targets.map((t) => t.installationId)).toEqual([
      "opencode-global",
      "opencode-proj-a",
    ]);
  });

  it("is deterministic regardless of target input order", () => {
    const reversed: ActualState = {
      ...state,
      targets: [...state.targets].reverse(),
    };
    expect(targetsForSkill(reversed, "code-review")).toEqual(
      targetsForSkill(state, "code-review"),
    );
  });

  it("returns an empty list for an unknown skill", () => {
    expect(targetsForSkill(state, "nope")).toEqual([]);
  });
});

describe("summarizeLinkStates", () => {
  it("counts targets per link state, omitting absent states", () => {
    expect(summarizeLinkStates(state)).toEqual({
      broken: 1,
      linked: 1,
      unmanaged: 1,
    });
  });

  it("is deterministic regardless of target input order", () => {
    const reversed: ActualState = {
      ...state,
      targets: [...state.targets].reverse(),
    };
    expect(summarizeLinkStates(reversed)).toEqual(summarizeLinkStates(state));
  });
});
