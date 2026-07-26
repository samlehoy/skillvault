import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import { createPlan, type Plan } from "../core/plan.js";
import { App, type InventoryRow, type TuiCore } from "./app.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

const rows: InventoryRow[] = [
  {
    id: "code-review",
    scope: "global",
    location: "opencode",
    health: "ok",
    path: "C:/Users/dev/.config/opencode/skills/code-review",
  },
  {
    id: "wrangler",
    scope: "global",
    location: "agents-external",
    health: "unmanaged",
    path: "C:/Users/dev/.agents/skills/wrangler",
  },
];

const samplePlan: Plan = createPlan({
  preconditions: [],
  operations: [
    {
      kind: "backup",
      sourcePath: rows[1]!.path,
      backupId: "bak-1234",
    },
    {
      kind: "link-create",
      installationId: "opencode:global",
      path: rows[1]!.path,
      targetPath: "C:/Users/dev/.skillvault/vault/wrangler/abc",
    },
  ],
  ownership: [{ path: rows[1]!.path, ownership: "user-owned" }],
  postConditions: [],
});

const makeCore = (overrides: Partial<TuiCore> = {}): TuiCore => ({
  loadInventory: () => rows,
  buildLinkPlan: vi.fn(() => ({ ok: true as const, plan: samplePlan, noop: false })),
  applyPlan: vi.fn(() => ({ ok: true as const, message: "applied" })),
  ...overrides,
});

describe("App", () => {
  it("renders the dashboard summary and inventory rows", async () => {
    const { lastFrame, unmount } = render(<App core={makeCore()} />);
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("SkillVault");
    expect(frame).toContain("2 skills");
    expect(frame).toContain("code-review");
    expect(frame).toContain("wrangler");
    unmount();
  });

  it("shows the selected skill in a detail panel and moves with arrows", async () => {
    const { lastFrame, stdin, unmount } = render(<App core={makeCore()} />);
    await tick();
    expect(lastFrame()).toContain("code-review");

    stdin.write("\u001B[B");
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("agents-external");
    expect(frame).toMatch(/❯ ○ unmanaged +wrangler/);
    unmount();
  });

  it("opens plan review showing operations and backups", async () => {
    const core = makeCore();
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();
    stdin.write("\u001B[B");
    await tick();
    stdin.write("l");
    await tick();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Plan review");
    expect(frame).toContain("backup");
    expect(frame).toContain("link-create");
    expect(frame).toContain("bak-1234");
    expect(core.buildLinkPlan).toHaveBeenCalledWith("wrangler");
    unmount();
  });

  it("cancelling plan review performs no mutation", async () => {
    const core = makeCore();
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();
    stdin.write("l");
    await tick();
    expect(lastFrame()).toContain("Plan review");

    stdin.write("n");
    await tick();
    expect(lastFrame()).not.toContain("Plan review");
    expect(core.applyPlan).not.toHaveBeenCalled();
    unmount();
  });

  it("applying the plan calls the core exactly once and shows the result", async () => {
    const core = makeCore();
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();
    stdin.write("l");
    await tick();
    stdin.write("y");
    await tick();

    expect(core.applyPlan).toHaveBeenCalledTimes(1);
    expect(core.applyPlan).toHaveBeenCalledWith(samplePlan);
    expect(lastFrame()).toContain("applied");
    unmount();
  });

  it("shows a failure result when apply reports rollback", async () => {
    const core = makeCore({
      applyPlan: vi.fn(() => ({
        ok: false as const,
        message: "operation failed; rolled back",
      })),
    });
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();
    stdin.write("l");
    await tick();
    stdin.write("y");
    await tick();

    expect(lastFrame()).toContain("rolled back");
    unmount();
  });

  it("windows large inventories with more-indicators instead of overflowing", async () => {
    const many: InventoryRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: `skill-${String(i).padStart(2, "0")}`,
      scope: "global",
      location: "opencode",
      health: "ok",
      path: `C:/skills/skill-${i}`,
    }));
    const core = makeCore({ loadInventory: () => many });
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();

    let frame = lastFrame() ?? "";
    expect(frame).toContain("30 skills");
    expect(frame).toContain("skill-00");
    expect(frame).not.toContain("skill-29");
    expect(frame).toContain("↓ 18 more");

    for (let i = 0; i < 29; i++) stdin.write("\u001B[B");
    await tick();
    frame = lastFrame() ?? "";
    expect(frame).toContain("skill-29");
    expect(frame).toContain("↑ 18 more");
    expect(frame).not.toContain("skill-00");
    unmount();
  });

  it("shows plan-build errors without leaving the inventory", async () => {
    const core = makeCore({
      buildLinkPlan: vi.fn(() => ({
        ok: false as const,
        message: "a file occupies the target",
      })),
    });
    const { lastFrame, stdin, unmount } = render(<App core={core} />);
    await tick();
    stdin.write("l");
    await tick();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("a file occupies the target");
    expect(frame).toContain("code-review");
    unmount();
  });
});
