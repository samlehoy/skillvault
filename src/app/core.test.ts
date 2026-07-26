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

const opencodeSkills = () => path.join(home, ".config", "opencode", "skills");
const agentsSkills = () => path.join(home, ".agents", "skills");

const makeSkill = (base: string, id: string, body = "body\n"): string => {
  const dir = path.join(base, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${id}\ndescription: d\n---\n${body}`,
  );
  return dir;
};

describe("loadInventory (aggregated)", () => {
  it("aggregates the same id across locations into one row", () => {
    makeSkill(opencodeSkills(), "wrangler");
    makeSkill(agentsSkills(), "wrangler");
    makeSkill(opencodeSkills(), "solo");

    const rows = createTuiCore({ homeDir: home }).loadInventory();
    expect(rows.map((r) => r.id)).toEqual(["solo", "wrangler"]);

    const wrangler = rows.find((r) => r.id === "wrangler");
    expect(wrangler?.locations).toHaveLength(2);
    expect(wrangler?.targets["opencode"]).toBe(true);
    expect(wrangler?.targets["agents-external"]).toBe(true);
    expect(wrangler?.targets["claude-external"]).toBe(false);
  });

  it("aggregate health is the most attention-worthy location health", () => {
    const store = makeSkill(path.join(home, "store"), "mixed");
    fs.mkdirSync(opencodeSkills(), { recursive: true });
    createJunction(store, path.join(opencodeSkills(), "mixed"));
    fs.rmSync(store, { recursive: true, force: true });
    makeSkill(agentsSkills(), "mixed");

    const rows = createTuiCore({ homeDir: home }).loadInventory();
    expect(rows[0]?.health).toBe("broken");
  });

  it("labels skills with Declared bundles from installer lockfiles", () => {
    makeSkill(agentsSkills(), "wrangler");
    makeSkill(opencodeSkills(), "homegrown");
    fs.writeFileSync(
      path.join(home, ".agents", ".skill-lock.json"),
      JSON.stringify({
        version: 3,
        skills: {
          wrangler: { source: "cloudflare/skills", sourceType: "github" },
        },
      }),
      "utf8",
    );

    const rows = createTuiCore({ homeDir: home }).loadInventory();
    expect(rows.find((r) => r.id === "wrangler")?.bundle).toBe(
      "cloudflare/skills",
    );
    expect(rows.find((r) => r.id === "homegrown")?.bundle).toBeUndefined();
  });

  it("sorts most attention-worthy first, then alphabetically", () => {
    makeSkill(opencodeSkills(), "bbb");
    const foreign = makeSkill(path.join(home, "elsewhere"), "aaa");
    fs.mkdirSync(path.join(home, ".claude", "skills"), { recursive: true });
    createJunction(foreign, path.join(home, ".claude", "skills", "aaa"));

    const rows = createTuiCore({ homeDir: home }).loadInventory();
    expect(rows.map((r) => `${r.health}:${r.id}`)).toEqual([
      "unmanaged:bbb",
      "external:aaa",
    ]);
  });
});

describe("checkContent", () => {
  it("reports identical copies as identical", () => {
    makeSkill(opencodeSkills(), "same", "identical\n");
    makeSkill(agentsSkills(), "same", "identical\n");
    const check = createTuiCore({ homeDir: home }).checkContent("same");
    expect(check).toEqual({ identical: true });
  });

  it("reports differing copies with pickable options", () => {
    makeSkill(opencodeSkills(), "diff", "version A\n");
    makeSkill(agentsSkills(), "diff", "version B\n");
    const check = createTuiCore({ homeDir: home }).checkContent("diff");
    expect(check.identical).toBe(false);
    if (!check.identical) {
      expect(check.options).toHaveLength(2);
      expect(check.options[0]?.hashShort).toMatch(/^[0-9a-f]{12}$/);
      expect(check.options[0]?.hashShort).not.toBe(check.options[1]?.hashShort);
    }
  });
});

describe("buildManagePlan", () => {
  it("manages multiple identical locations in one consolidated plan", () => {
    const a = makeSkill(opencodeSkills(), "multi", "same\n");
    const b = makeSkill(agentsSkills(), "multi", "same\n");
    const core = createTuiCore({ homeDir: home });

    const built = core.buildManagePlan({ id: "multi", paths: [a, b] });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.plan.operations.map((o) => o.kind)).toEqual([
      "backup",
      "link-create",
      "backup",
      "link-create",
    ]);

    const applied = core.applyPlan(built.plan);
    expect(applied.ok).toBe(true);
    for (const p of [a, b]) {
      const inspection = inspectPath(p);
      expect(inspection.kind).toBe("junction");
    }
    const row = core.loadInventory().find((r) => r.id === "multi");
    expect(row?.health).toBe("managed");
  });

  it("returns a conflict when copies differ and no canonical was chosen", () => {
    const a = makeSkill(opencodeSkills(), "conf", "A\n");
    const b = makeSkill(agentsSkills(), "conf", "B\n");
    const built = createTuiCore({ homeDir: home }).buildManagePlan({
      id: "conf",
      paths: [a, b],
    });
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.code).toBe("conflict");
  });

  it("uses the chosen canonical copy when copies differ", () => {
    const a = makeSkill(opencodeSkills(), "conf", "CANONICAL\n");
    const b = makeSkill(agentsSkills(), "conf", "other\n");
    const core = createTuiCore({ homeDir: home });

    const built = core.buildManagePlan({
      id: "conf",
      paths: [a, b],
      canonicalPath: a,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(core.applyPlan(built.plan).ok).toBe(true);
    expect(fs.readFileSync(path.join(b, "SKILL.md"), "utf8")).toContain(
      "CANONICAL",
    );
  });

  it("creates a link at a target where the skill does not exist yet", () => {
    makeSkill(agentsSkills(), "only-store", "content\n");
    const core = createTuiCore({ homeDir: home });
    const creatable = core.creatableTargets("only-store");
    const opencodeTarget = creatable.find((t) => t.key === "opencode");
    expect(opencodeTarget).toBeDefined();

    const built = core.buildManagePlan({
      id: "only-store",
      paths: [path.join(agentsSkills(), "only-store")],
      createKeys: ["opencode"],
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(core.applyPlan(built.plan).ok).toBe(true);
    const created = inspectPath(path.join(opencodeSkills(), "only-store"));
    expect(created.kind).toBe("junction");
  });

  it("never offers the agents store as a creatable target (ADR-0005)", () => {
    makeSkill(opencodeSkills(), "oc-only");
    const creatable = createTuiCore({ homeDir: home }).creatableTargets(
      "oc-only",
    );
    expect(creatable.map((t) => t.key)).not.toContain("agents-external");
  });

  it("reports unknown ids cleanly", () => {
    const built = createTuiCore({ homeDir: home }).buildManagePlan({
      id: "ghost",
      paths: [],
    });
    expect(built.ok).toBe(false);
    if (!built.ok && built.code === "error") {
      expect(built.message).toContain("ghost");
    }
  });
});
