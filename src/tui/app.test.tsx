import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type {
  AggregatedSkillView,
  ContentCheck,
  TuiCore,
} from "../app/core.js";
import { createPlan, type Plan } from "../core/plan.js";
import { App } from "./app.js";

// Ink recognizes a lone ESC only after its ~30ms escape-sequence
// disambiguation window; keep ticks comfortably above that.
const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

const wrangler: AggregatedSkillView = {
  id: "wrangler",
  health: "unmanaged",
  locations: [
    {
      key: "opencode",
      scope: "global",
      path: "C:/home/.config/opencode/skills/wrangler",
      entryKind: "directory",
      health: "unmanaged",
    },
    {
      key: "agents-external",
      scope: "global",
      path: "C:/home/.agents/skills/wrangler",
      entryKind: "directory",
      health: "unmanaged",
    },
  ],
  targets: { opencode: true, "claude-external": false, "agents-external": true },
};

const askMatt: AggregatedSkillView = {
  id: "ask-matt",
  health: "external",
  locations: [
    {
      key: "claude-external",
      scope: "global",
      path: "C:/home/.claude/skills/ask-matt",
      entryKind: "junction",
      health: "external",
    },
  ],
  targets: { opencode: false, "claude-external": true, "agents-external": false },
};

const samplePlan: Plan = createPlan({
  preconditions: [],
  operations: [
    {
      kind: "backup",
      sourcePath: wrangler.locations[0]!.path,
      backupId: "bak-1234",
    },
    {
      kind: "link-create",
      installationId: "opencode:global",
      path: wrangler.locations[0]!.path,
      targetPath: "C:/home/.skillvault/vault/wrangler/abc",
    },
  ],
  ownership: [{ path: wrangler.locations[0]!.path, ownership: "user-owned" }],
  postConditions: [],
});

const makeCore = (overrides: Partial<TuiCore> = {}): TuiCore => ({
  loadInventory: () => [wrangler, askMatt],
  checkContent: vi.fn((): ContentCheck => ({ identical: true })),
  creatableTargets: vi.fn((id: string) =>
    id === "wrangler"
      ? [{ key: "claude-external" as const, path: "C:/home/.claude/skills/wrangler" }]
      : [],
  ),
  buildManagePlan: vi.fn(() => ({ ok: true as const, plan: samplePlan, noop: false })),
  applyPlan: vi.fn(() => ({ ok: true as const, message: "applied" })),
  ...overrides,
});

describe("inventory", () => {
  it("renders one row per skill with presence matrix and copy count", async () => {
    const { lastFrame, unmount } = render(<App core={makeCore()} />);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("2 skills");
    expect(frame).toMatch(/wrangler.+oc✓ cl– ag✓.+2 copies/);
    expect(frame).toMatch(/ask-matt.+oc– cl✓ ag–/);
    unmount();
  });

  it("shows the legend and the selected skill's locations", async () => {
    const { lastFrame, unmount } = render(<App core={makeCore()} />);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("link owned by another tool");
    expect(frame).toContain("found in 2 locations");
    expect(frame).toContain("(store)");
    expect(frame).toContain("(copy)");
    unmount();
  });

  it("filters by target with number keys and resets with a", async () => {
    const { lastFrame, stdin, unmount } = render(<App core={makeCore()} />);
    await tick();
    stdin.write("2");
    await tick();
    let frame = lastFrame() ?? "";
    expect(frame).toContain("ask-matt");
    expect(frame).not.toMatch(/❯.*wrangler|  . wrangler/);

    stdin.write("a");
    await tick();
    frame = lastFrame() ?? "";
    expect(frame).toContain("wrangler");
    unmount();
  });

  it("searches incrementally with / and clears with Esc", async () => {
    const { lastFrame, stdin, unmount } = render(<App core={makeCore()} />);
    await tick();
    stdin.write("/");
    await tick();
    stdin.write("ask");
    await tick();
    let frame = lastFrame() ?? "";
    expect(frame).toContain("ask-matt");
    expect(frame).not.toContain("wrangler");

    stdin.write("\u001B");
    await tick();
    frame = lastFrame() ?? "";
    expect(frame).toContain("wrangler");
    unmount();
  });

  it("opens the help overlay with ? and closes on any key", async () => {
    const { lastFrame, stdin, unmount } = render(<App core={makeCore()} />);
    await tick();
    stdin.write("?");
    await tick();
    expect(lastFrame()).toContain("cancel changes nothing");
    stdin.write("x");
    await tick();
    expect(lastFrame()).toContain("2 skills");
    unmount();
  });
});

describe("action panel", () => {
  it("opens on Enter with existing locations checked and creatable targets unchecked", async () => {
    const { lastFrame, stdin, unmount } = render(<App core={makeCore()} />);
    await tick();
    stdin.write("\r");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Manage in which targets?");
    expect(frame).toMatch(/\[x\] opencode/);
    expect(frame).toMatch(/\[x\] agents/);
    expect(frame).toMatch(/\[ \] claude.+will be created/);
    expect(frame).toContain("content identical");
    unmount();
  });

  it("space toggles the highlighted entry", async () => {
    const { lastFrame, stdin, unmount } = render(<App core={makeCore()} />);
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write(" ");
    await tick();
    expect(lastFrame()).toMatch(/\[ \] opencode/);
    unmount();
  });

  it("Esc returns to the inventory without building anything", async () => {
    const core = makeCore();
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\u001B");
    await tick();
    expect(lastFrame()).toContain("2 skills");
    expect(core.buildManagePlan).not.toHaveBeenCalled();
    unmount();
  });

  it("m builds a plan from the checked entries", async () => {
    const core = makeCore();
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\u001B[B");
    await tick();
    stdin.write("\u001B[B");
    await tick();
    stdin.write(" ");
    await tick();
    stdin.write("m");
    await tick();

    expect(core.buildManagePlan).toHaveBeenCalledWith({
      id: "wrangler",
      paths: [wrangler.locations[0]!.path, wrangler.locations[1]!.path],
      createKeys: ["claude-external"],
    });
    expect(lastFrame()).toContain("Plan review");
    unmount();
  });
});

describe("conflict gate", () => {
  const conflict: ContentCheck = {
    identical: false,
    options: [
      { key: "opencode", path: wrangler.locations[0]!.path, hashShort: "aaaaaaaaaaaa" },
      { key: "agents-external", path: wrangler.locations[1]!.path, hashShort: "bbbbbbbbbbbb" },
    ],
  };

  it("shows the canonical-source picker before the action panel", async () => {
    const core = makeCore({ checkContent: vi.fn(() => conflict) });
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();
    stdin.write("\r");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("DIFFERENT content");
    expect(frame).toContain("aaaaaaaaaaaa");
    expect(frame).toContain("bbbbbbbbbbbb");
    unmount();
  });

  it("choosing a copy pins it as canonical for the manage plan", async () => {
    const core = makeCore({ checkContent: vi.fn(() => conflict) });
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("\u001B[B");
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).toContain("canonical:");

    stdin.write("m");
    await tick();
    expect(core.buildManagePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        canonicalPath: wrangler.locations[1]!.path,
      }),
    );
    unmount();
  });
});

describe("plan review and result", () => {
  const toPlanReview = async (core: TuiCore) => {
    const rendered = render(<App core={core} />);
    await tick();
    rendered.stdin.write("\r");
    await tick();
    rendered.stdin.write("m");
    await tick();
    return rendered;
  };

  it("cancelling performs no mutation", async () => {
    const core = makeCore();
    const { lastFrame, stdin, unmount } = await toPlanReview(core);
    expect(lastFrame()).toContain("Plan review");
    stdin.write("n");
    await tick();
    expect(lastFrame()).not.toContain("Plan review");
    expect(core.applyPlan).not.toHaveBeenCalled();
    unmount();
  });

  it("applying calls the core exactly once and reloads the inventory after", async () => {
    const loadInventory = vi.fn(() => [wrangler, askMatt]);
    const core = makeCore({ loadInventory });
    const { lastFrame, stdin, unmount } = await toPlanReview(core);
    stdin.write("y");
    await tick();
    expect(core.applyPlan).toHaveBeenCalledTimes(1);
    expect(core.applyPlan).toHaveBeenCalledWith(samplePlan);
    expect(lastFrame()).toContain("applied");

    const loadsBefore = loadInventory.mock.calls.length;
    stdin.write("x");
    await tick();
    expect(loadInventory.mock.calls.length).toBeGreaterThan(loadsBefore);
    expect(lastFrame()).toContain("2 skills");
    unmount();
  });

  it("shows failure with rollback message", async () => {
    const core = makeCore({
      applyPlan: vi.fn(() => ({
        ok: false as const,
        message: "operation failed; rolled back",
      })),
    });
    const { lastFrame, stdin, unmount } = await toPlanReview(core);
    stdin.write("y");
    await tick();
    expect(lastFrame()).toContain("rolled back");
    unmount();
  });

  it("shows manage-plan errors inside the action panel", async () => {
    const core = makeCore({
      buildManagePlan: vi.fn(() => ({
        ok: false as const,
        code: "error" as const,
        message: "a file occupies the target",
      })),
    });
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("m");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("a file occupies the target");
    expect(frame).toContain("Manage in which targets?");
    unmount();
  });
});

describe("viewport", () => {
  it("windows large inventories with more-indicators", async () => {
    const many: AggregatedSkillView[] = Array.from({ length: 30 }, (_, i) => ({
      id: `skill-${String(i).padStart(2, "0")}`,
      health: "managed" as const,
      locations: [
        {
          key: "opencode" as const,
          scope: "global" as const,
          path: `C:/skills/skill-${i}`,
          entryKind: "junction" as const,
          health: "managed" as const,
        },
      ],
      targets: {
        opencode: true,
        "claude-external": false,
        "agents-external": false,
      },
    }));
    const core = makeCore({ loadInventory: () => many });
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();

    let frame = lastFrame() ?? "";
    expect(frame).toContain("skill-00");
    expect(frame).not.toContain("skill-29");
    expect(frame).toContain("↓ 18 more");

    for (let i = 0; i < 29; i++) stdin.write("\u001B[B");
    await tick();
    frame = lastFrame() ?? "";
    expect(frame).toContain("skill-29");
    expect(frame).toContain("↑ 18 more");
    unmount();
  });
});
