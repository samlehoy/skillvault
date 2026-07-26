import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDoctor } from "./doctor.js";

let home: string;
let scratch: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-doc-home-"));
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-doc-scratch-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
});

const gitOk = () => "git version 2.53.0";
const gitMissing = () => null;

describe("runDoctor", () => {
  it("reports a stable, ordered set of checks", () => {
    const report = runDoctor({ homeDir: home, scratchDir: scratch, gitVersion: gitOk });
    expect(report.checks.map((c) => c.id)).toEqual([
      "node-version",
      "git",
      "junction-capability",
      "opencode-installation",
      "opencode-skills",
      "vault-root",
      "transactions",
    ]);
  });

  it("fails with details when the journal holds interrupted transactions", () => {
    const dir = path.join(home, ".skillvault", "state", "transactions");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "plan-crashed.json"),
      JSON.stringify({
        planId: "plan-crashed",
        status: "in-progress",
        operations: [{ kind: "link-create" }],
        applied: [],
        rollbackErrors: [],
        startedAt: "2026-07-27T00:00:00.000Z",
      }),
      "utf8",
    );
    const report = runDoctor({ homeDir: home, scratchDir: scratch, gitVersion: gitOk });
    expect(report.ok).toBe(false);
    const check = report.checks.find((c) => c.id === "transactions");
    expect(check?.status).toBe("fail");
    expect(check?.detail).toContain("plan-crashed");
    expect(check?.detail).toContain("0/1 ops applied");
  });

  it("passes on a healthy environment with an installed OpenCode", () => {
    fs.mkdirSync(path.join(home, ".config", "opencode", "skills", "a"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(home, ".config", "opencode", "skills", "a", "SKILL.md"),
      "---\nname: a\ndescription: d\n---\nbody\n",
    );

    const report = runDoctor({ homeDir: home, scratchDir: scratch, gitVersion: gitOk });
    expect(report.ok).toBe(true);
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["git"]?.status).toBe("pass");
    expect(byId["junction-capability"]?.status).toBe("pass");
    expect(byId["opencode-installation"]?.status).toBe("pass");
    expect(byId["opencode-skills"]?.status).toBe("pass");
    expect(byId["opencode-skills"]?.detail).toContain("1");
  });

  it("fails when git is unavailable", () => {
    const report = runDoctor({ homeDir: home, scratchDir: scratch, gitVersion: gitMissing });
    expect(report.ok).toBe(false);
    const git = report.checks.find((c) => c.id === "git");
    expect(git?.status).toBe("fail");
  });

  it("warns (not fails) when OpenCode is absent and the vault is uninitialized", () => {
    const report = runDoctor({ homeDir: home, scratchDir: scratch, gitVersion: gitOk });
    expect(report.ok).toBe(true);
    const byId = Object.fromEntries(report.checks.map((c) => [c.id, c]));
    expect(byId["opencode-installation"]?.status).toBe("warn");
    expect(byId["vault-root"]?.status).toBe("warn");
  });

  it("reports an initialized vault root as pass", () => {
    fs.mkdirSync(path.join(home, ".skillvault", "vault"), { recursive: true });
    const report = runDoctor({ homeDir: home, scratchDir: scratch, gitVersion: gitOk });
    const vault = report.checks.find((c) => c.id === "vault-root");
    expect(vault?.status).toBe("pass");
  });

  it("leaves no residue in the scratch directory", () => {
    runDoctor({ homeDir: home, scratchDir: scratch, gitVersion: gitOk });
    expect(fs.readdirSync(scratch)).toEqual([]);
  });

  it("is read-only with respect to the home directory", () => {
    runDoctor({ homeDir: home, scratchDir: scratch, gitVersion: gitOk });
    expect(fs.readdirSync(home)).toEqual([]);
  });

  it("serializes to JSON cleanly for --json output", () => {
    const report = runDoctor({ homeDir: home, scratchDir: scratch, gitVersion: gitOk });
    const roundTripped: unknown = JSON.parse(JSON.stringify(report));
    expect(roundTripped).toEqual(report);
  });
});
