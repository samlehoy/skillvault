import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Lockfile } from "../core/manifest.js";
import {
  applyLockUpdate,
  loadProjectLockfile,
  loadProjectManifest,
  lockfilePathFor,
  manifestPathFor,
  saveProjectLockfile,
} from "./manifest-io.js";

let root: string;
let counter = 0;

const freshProject = (): string => {
  const dir = path.join(root, `project-${counter++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-manifest-io-"));
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const sampleLockfile: Lockfile = {
  schema: 1,
  skills: {
    wrangler: {
      source: { type: "git", repository: "https://github.com/cloudflare/skills.git", subdir: "skills/wrangler" },
      resolved: { commit: "a".repeat(40), contentHash: `sha256:${"1".repeat(64)}` },
    },
    "ask-matt": {
      source: { type: "local", path: "C:/skills/ask-matt" },
      resolved: { contentHash: `sha256:${"2".repeat(64)}` },
    },
  },
};

describe("project lockfile IO", () => {
  it("absent files load as present: false, not as errors", () => {
    const projectDir = freshProject();
    expect(loadProjectManifest(projectDir)).toEqual({ ok: true, present: false });
    expect(loadProjectLockfile(projectDir)).toEqual({ ok: true, present: false });
  });

  it("round-trips a lockfile through save and load", () => {
    const projectDir = freshProject();
    saveProjectLockfile(projectDir, sampleLockfile);
    const loaded = loadProjectLockfile(projectDir);
    expect(loaded.ok && loaded.present && loaded.lockfile).toEqual(sampleLockfile);
  });

  it("serializes deterministically for source control: sorted keys, LF, trailing newline", () => {
    const projectDir = freshProject();
    saveProjectLockfile(projectDir, sampleLockfile);
    const text = fs.readFileSync(lockfilePathFor(projectDir), "utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toContain("\r");
    // "ask-matt" sorts before "wrangler" even though it was declared second.
    expect(text.indexOf('"ask-matt"')).toBeLessThan(text.indexOf('"wrangler"'));

    // Byte-identical on rewrite: no churn in diffs.
    const first = text;
    saveProjectLockfile(projectDir, sampleLockfile);
    expect(fs.readFileSync(lockfilePathFor(projectDir), "utf8")).toBe(first);
  });

  it("rejects malformed JSON and unsupported schema versions fail closed", () => {
    const projectDir = freshProject();
    fs.mkdirSync(path.dirname(lockfilePathFor(projectDir)), { recursive: true });
    fs.writeFileSync(lockfilePathFor(projectDir), "{not json", "utf8");
    const malformed = loadProjectLockfile(projectDir);
    expect(!malformed.ok && malformed.errors[0]?.code).toBe("lockfile/invalid-json");

    fs.writeFileSync(
      lockfilePathFor(projectDir),
      JSON.stringify({ schema: 99, skills: {} }),
      "utf8",
    );
    const future = loadProjectLockfile(projectDir);
    expect(!future.ok && future.errors[0]?.code).toBe("lockfile/unsupported-schema");
  });
});

describe("project manifest IO", () => {
  it("parses a YAML manifest", () => {
    const projectDir = freshProject();
    fs.mkdirSync(path.dirname(manifestPathFor(projectDir)), { recursive: true });
    fs.writeFileSync(
      manifestPathFor(projectDir),
      [
        "schema: 1",
        "skills:",
        "  wrangler:",
        "    source:",
        "      type: git",
        "      repository: https://github.com/cloudflare/skills.git",
        "      subdir: skills/wrangler",
        "",
      ].join("\n"),
      "utf8",
    );
    const loaded = loadProjectManifest(projectDir);
    expect(loaded.ok && loaded.present).toBe(true);
    if (!loaded.ok || !loaded.present) return;
    const entry = loaded.manifest.skills["wrangler"];
    expect(entry && "source" in entry && entry.source.type).toBe("git");
  });

  it("reports YAML syntax errors as structured errors", () => {
    const projectDir = freshProject();
    fs.mkdirSync(path.dirname(manifestPathFor(projectDir)), { recursive: true });
    fs.writeFileSync(manifestPathFor(projectDir), "schema: [unclosed", "utf8");
    const loaded = loadProjectManifest(projectDir);
    expect(!loaded.ok && loaded.errors[0]?.code).toBe("manifest/invalid-yaml");
  });
});

describe("applyLockUpdate", () => {
  it("returns a new lockfile with the entry replaced and never mutates the input", () => {
    const updated = applyLockUpdate(sampleLockfile, "wrangler", {
      source: { type: "git", repository: "https://github.com/cloudflare/skills.git", subdir: "skills/wrangler" },
      resolved: { commit: "b".repeat(40), contentHash: `sha256:${"3".repeat(64)}` },
    });
    expect(updated).not.toBe(sampleLockfile);
    const entry = updated.skills["wrangler"];
    expect(entry && "commit" in entry.resolved && entry.resolved.commit).toBe(
      "b".repeat(40),
    );
    const original = sampleLockfile.skills["wrangler"];
    expect(original && "commit" in original.resolved && original.resolved.commit).toBe(
      "a".repeat(40),
    );
    expect(updated.skills["ask-matt"]).toEqual(sampleLockfile.skills["ask-matt"]);
  });
});
