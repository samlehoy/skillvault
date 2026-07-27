import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJunction } from "../fs/junction.js";
import { runAudit } from "./audit.js";

/**
 * M6 audit engine: deterministic, read-only findings with stable IDs,
 * severity, and remediation intent. `ok` means "no error-severity finding"
 * — warnings and infos never fail an audit.
 */

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-audit-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const makeSkill = (base: string, id: string, body = "body\n"): string => {
  const dir = path.join(home, base, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${id}\ndescription: d\n---\n${body}`,
  );
  return dir;
};

describe("runAudit", () => {
  it("a healthy labelled inventory audits clean", () => {
    makeSkill(".agents/skills", "wrangler");
    fs.writeFileSync(
      path.join(home, ".agents", ".skill-lock.json"),
      JSON.stringify({
        version: 3,
        skills: { wrangler: { source: "cloudflare/skills" } },
      }),
      "utf8",
    );
    const report = runAudit({ homeDir: home });
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([]);
  });

  it("reports broken links as errors with the dangling path", () => {
    const target = makeSkill("elsewhere", "ghost");
    const skillsDir = path.join(home, ".config", "opencode", "skills");
    fs.mkdirSync(skillsDir, { recursive: true });
    createJunction(target, path.join(skillsDir, "ghost"));
    fs.rmSync(target, { recursive: true, force: true });

    const report = runAudit({ homeDir: home });
    expect(report.ok).toBe(false);
    const finding = report.findings.find((f) => f.category === "broken-link");
    expect(finding?.severity).toBe("error");
    expect(finding?.id).toBe("broken-link:ghost");
    expect(finding?.paths[0]).toContain("ghost");
    expect(finding?.remediation).toBeTruthy();
  });

  it("reports same-id divergent content as an error", () => {
    makeSkill(".config/opencode/skills", "clash", "A\n");
    makeSkill(".agents/skills", "clash", "B\n");
    const report = runAudit({ homeDir: home });
    const finding = report.findings.find((f) => f.category === "content-conflict");
    expect(finding?.severity).toBe("error");
    expect(finding?.id).toBe("content-conflict:clash");
    expect(finding?.paths).toHaveLength(2);
    expect(report.ok).toBe(false);
  });

  it("reports duplicate visibility and unknown provenance below error severity", () => {
    makeSkill(".config/opencode/skills", "twin", "same\n");
    makeSkill(".agents/skills", "twin", "same\n");
    const report = runAudit({ homeDir: home });
    expect(report.ok).toBe(true);

    const dup = report.findings.find((f) => f.category === "duplicate-visibility");
    expect(dup?.severity).toBe("info");
    expect(dup?.id).toBe("duplicate-visibility:twin");
    expect(dup?.paths).toHaveLength(2);

    const unknown = report.findings.filter(
      (f) => f.category === "unknown-provenance",
    );
    expect(unknown.map((f) => f.skillId)).toEqual(["twin"]);
    expect(unknown[0]?.severity).toBe("info");
  });

  it("reports likely duplicates (different ids, identical content) as warnings", () => {
    // A renamed copy: different directory name, byte-identical content.
    const identical = "---\nname: web-perf\ndescription: d\n---\nbody\n";
    for (const [base, id] of [
      [".config/opencode/skills", "web-perf"],
      [".agents/skills", "web-performance"],
    ] as const) {
      const dir = path.join(home, base, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "SKILL.md"), identical, "utf8");
    }
    const report = runAudit({ homeDir: home });
    const finding = report.findings.find((f) => f.category === "likely-duplicate");
    expect(finding?.severity).toBe("warn");
    expect(finding?.message).toContain("web-perf");
    expect(finding?.message).toContain("web-performance");
  });

  it("reports interrupted transactions from the journal as errors", () => {
    const dir = path.join(home, ".skillvault", "state", "transactions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plan-crashed.json"),
      JSON.stringify({
        planId: "plan-crashed",
        status: "in-progress",
        operations: [],
        applied: [],
        rollbackErrors: [],
        startedAt: "2026-07-27T00:00:00.000Z",
      }),
      "utf8",
    );
    const report = runAudit({ homeDir: home });
    const finding = report.findings.find(
      (f) => f.category === "interrupted-transaction",
    );
    expect(finding?.severity).toBe("error");
    expect(finding?.id).toBe("interrupted-transaction:plan-crashed");
  });

  it("is deterministic and sorted by severity then id", () => {
    makeSkill(".config/opencode/skills", "clash", "A\n");
    makeSkill(".agents/skills", "clash", "B\n");
    makeSkill(".config/opencode/skills", "solo");
    const first = runAudit({ homeDir: home });
    const second = runAudit({ homeDir: home });
    expect(first).toEqual(second);
    const severities = first.findings.map((f) => f.severity);
    const rank = { error: 0, warn: 1, info: 2 };
    expect([...severities].sort((a, b) => rank[a] - rank[b])).toEqual(severities);
  });

  it("mutates nothing", () => {
    makeSkill(".config/opencode/skills", "quiet");
    const before = fs.readdirSync(home).sort();
    runAudit({ homeDir: home });
    expect(fs.readdirSync(home).sort()).toEqual(before);
    expect(fs.existsSync(path.join(home, ".skillvault"))).toBe(false);
  });
});
