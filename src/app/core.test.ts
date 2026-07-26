import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJunction, inspectPath } from "../fs/junction.js";
import { createTuiCore } from "./core.js";

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-app-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const skillsDir = () => path.join(home, ".config", "opencode", "skills");

const makeOpenCodeSkill = (id: string, valid = true): string => {
  const dir = path.join(skillsDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  if (valid) {
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${id}\ndescription: d\n---\nbody\n`,
    );
  }
  return dir;
};

describe("createTuiCore", () => {
  it("maps discovered skills to inventory rows with health", () => {
    makeOpenCodeSkill("plain");
    const core = createTuiCore({ homeDir: home });
    const rows = core.loadInventory();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "plain", health: "unmanaged" });
  });

  it("classifies dangling junctions and foreign junctions", () => {
    const store = path.join(home, "store", "gone");
    fs.mkdirSync(store, { recursive: true });
    fs.mkdirSync(skillsDir(), { recursive: true });
    createJunction(store, path.join(skillsDir(), "gone"));
    fs.rmSync(store, { recursive: true, force: true });

    const foreign = path.join(home, "elsewhere", "skill");
    fs.mkdirSync(foreign, { recursive: true });
    createJunction(foreign, path.join(skillsDir(), "foreign"));

    const core = createTuiCore({ homeDir: home });
    const byId = Object.fromEntries(
      core.loadInventory().map((r) => [r.id, r.health]),
    );
    expect(byId["gone"]).toBe("dangling");
    expect(byId["foreign"]).toBe("drift");
  });

  it("manages an unmanaged skill end to end: ingest, backup, link, verify", () => {
    const sourceDir = makeOpenCodeSkill("web2md");
    const core = createTuiCore({ homeDir: home });

    const built = core.buildLinkPlan("web2md");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.operations.map((o) => o.kind)).toEqual([
      "backup",
      "link-create",
    ]);

    const applied = core.applyPlan(built.plan);
    expect(applied.ok).toBe(true);

    const inspection = inspectPath(sourceDir);
    expect(inspection.kind).toBe("junction");
    if (inspection.kind === "junction") {
      expect(
        inspection.target.startsWith(path.join(home, ".skillvault", "vault")),
      ).toBe(true);
    }
    expect(fs.readFileSync(path.join(sourceDir, "SKILL.md"), "utf8")).toContain(
      "web2md",
    );

    const backups = fs.readdirSync(path.join(home, ".skillvault", "backups"));
    expect(backups).toHaveLength(1);

    expect(core.loadInventory()[0]?.health).toBe("ok");
  });

  it("returns a noop plan for an already managed skill", () => {
    makeOpenCodeSkill("stable");
    const core = createTuiCore({ homeDir: home });
    const first = core.buildLinkPlan("stable");
    expect(first.ok).toBe(true);
    if (first.ok) core.applyPlan(first.plan);

    const second = core.buildLinkPlan("stable");
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.noop).toBe(true);
      expect(second.plan.operations).toEqual([]);
    }
  });

  it("reports invalid skills as structured messages, not throws", () => {
    makeOpenCodeSkill("broken", false);
    const core = createTuiCore({ homeDir: home });
    const built = core.buildLinkPlan("broken");
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.message).toContain("SKILL.md");
  });

  it("reports unknown skill ids cleanly", () => {
    const core = createTuiCore({ homeDir: home });
    const built = core.buildLinkPlan("ghost");
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.message).toContain("ghost");
  });
});
