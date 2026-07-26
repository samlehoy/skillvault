import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJunction } from "../fs/junction.js";
import { fingerprint, scanFingerprints, type FingerprintEntry } from "./fingerprint.js";

/**
 * M5 fingerprinting: exact duplicate grouping, same-ID-divergent-content
 * conflicts, and likely-duplicate candidates (different IDs, identical
 * content). Pure classification over content hashes; deterministic output
 * ordering regardless of input ordering.
 */

const entry = (
  id: string,
  p: string,
  contentHash: string,
  locationKey = "opencode",
): FingerprintEntry => ({ id, path: p, locationKey, contentHash });

const H1 = `sha256:${"a".repeat(64)}`;
const H2 = `sha256:${"b".repeat(64)}`;
const H3 = `sha256:${"c".repeat(64)}`;

describe("fingerprint", () => {
  it("groups identical copies of the same id as exact duplicates", () => {
    const report = fingerprint([
      entry("wrangler", "C:/oc/wrangler", H1),
      entry("wrangler", "C:/agents/wrangler", H1, "agents-external"),
      entry("solo", "C:/oc/solo", H2),
    ]);
    expect(report.exactDuplicates).toEqual([
      {
        id: "wrangler",
        contentHash: H1,
        paths: ["C:/agents/wrangler", "C:/oc/wrangler"],
      },
    ]);
    expect(report.conflicts).toEqual([]);
  });

  it("reports same-id different-content as a conflict with all variants", () => {
    const report = fingerprint([
      entry("conf", "C:/oc/conf", H1),
      entry("conf", "C:/agents/conf", H2, "agents-external"),
      entry("conf", "C:/gemini/conf", H2, "antigravity"),
    ]);
    expect(report.conflicts).toEqual([
      {
        id: "conf",
        variants: [
          { contentHash: H1, paths: ["C:/oc/conf"] },
          { contentHash: H2, paths: ["C:/agents/conf", "C:/gemini/conf"] },
        ],
      },
    ]);
    // A conflicted id never also appears as an exact duplicate.
    expect(report.exactDuplicates).toEqual([]);
  });

  it("reports different ids with identical content as likely duplicates", () => {
    const report = fingerprint([
      entry("web-perf", "C:/oc/web-perf", H3),
      entry("web-performance", "C:/agents/web-performance", H3, "agents-external"),
      entry("unrelated", "C:/oc/unrelated", H1),
    ]);
    expect(report.likelyDuplicates).toEqual([
      { contentHash: H3, ids: ["web-perf", "web-performance"] },
    ]);
  });

  it("collects unreadable entries separately without classifying them", () => {
    const report = fingerprint([
      entry("ok", "C:/oc/ok", H1),
      entry("bad", "C:/oc/bad", "unreadable"),
    ]);
    expect(report.unreadable).toEqual([{ id: "bad", path: "C:/oc/bad" }]);
    expect(report.conflicts).toEqual([]);
    expect(report.likelyDuplicates).toEqual([]);
  });

  it("is deterministic regardless of input order", () => {
    const entries = [
      entry("b-skill", "C:/2", H1),
      entry("a-skill", "C:/1", H1),
      entry("b-skill", "C:/3", H2, "agents-external"),
    ];
    const forward = fingerprint(entries);
    const reversed = fingerprint([...entries].reverse());
    expect(forward).toEqual(reversed);
  });
});

describe("scanFingerprints (filesystem integration)", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-fp-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  const makeSkill = (base: string, id: string, body: string): string => {
    const dir = path.join(home, base, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: ${id}\ndescription: d\n---\n${body}`,
    );
    return dir;
  };

  it("classifies a realistic mixed layout, including installer junctions, read-only", () => {
    // Identical copies across two IDE locations.
    makeSkill(".config/opencode/skills", "twin", "same\n");
    makeSkill(".agents/skills", "twin", "same\n");
    // Divergent content under one id.
    makeSkill(".config/opencode/skills", "clash", "A\n");
    makeSkill(".agents/skills", "clash", "B\n");
    // Installer-style junction into the agents store (counts as the same
    // content seen through a second path).
    const store = path.join(home, ".agents", "skills", "twin");
    const claudeDir = path.join(home, ".claude", "skills");
    fs.mkdirSync(claudeDir, { recursive: true });
    createJunction(store, path.join(claudeDir, "twin"));

    const before = fs.readdirSync(path.join(home, ".config", "opencode", "skills"));
    const report = scanFingerprints({ homeDir: home });
    const after = fs.readdirSync(path.join(home, ".config", "opencode", "skills"));
    expect(after).toEqual(before);

    expect(report.exactDuplicates).toHaveLength(1);
    expect(report.exactDuplicates[0]?.id).toBe("twin");
    expect(report.exactDuplicates[0]?.paths).toHaveLength(3);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]?.id).toBe("clash");
  });
});
