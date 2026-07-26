import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearUserAssertion,
  loadUserAssertions,
  overridesPathFor,
  saveUserAssertion,
} from "./store.js";

let stateRoot: string;

beforeEach(() => {
  stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-prov-"));
});

afterEach(() => {
  fs.rmSync(stateRoot, { recursive: true, force: true });
});

describe("provenance override store", () => {
  it("round-trips user assertions with sorted, stable serialization", () => {
    saveUserAssertion(stateRoot, "writing-plans", {
      repository: "obra/superpowers",
      assertedAt: "2026-07-27T10:00:00.000Z",
    });
    saveUserAssertion(stateRoot, "brainstorming", {
      repository: "obra/superpowers",
      assertedAt: "2026-07-27T10:01:00.000Z",
    });

    const { assertions, warning } = loadUserAssertions(stateRoot);
    expect(warning).toBeUndefined();
    expect(assertions.get("brainstorming")?.repository).toBe("obra/superpowers");
    expect(assertions.get("writing-plans")?.repository).toBe("obra/superpowers");

    const text = fs.readFileSync(overridesPathFor(stateRoot), "utf8");
    expect(text.indexOf("brainstorming")).toBeLessThan(text.indexOf("writing-plans"));
    expect(text.endsWith("\n")).toBe(true);
  });

  it("clears a single assertion without touching the others", () => {
    saveUserAssertion(stateRoot, "a", {
      repository: "x/y",
      assertedAt: "2026-07-27T10:00:00.000Z",
    });
    saveUserAssertion(stateRoot, "b", {
      repository: "x/y",
      assertedAt: "2026-07-27T10:00:00.000Z",
    });
    clearUserAssertion(stateRoot, "a");
    const { assertions } = loadUserAssertions(stateRoot);
    expect(assertions.has("a")).toBe(false);
    expect(assertions.has("b")).toBe(true);
  });

  it("missing file is an empty set, not an error", () => {
    const { assertions, warning } = loadUserAssertions(stateRoot);
    expect(assertions.size).toBe(0);
    expect(warning).toBeUndefined();
  });

  it("a corrupt file loads empty with a warning and is preserved as .bak on next save", () => {
    fs.mkdirSync(path.dirname(overridesPathFor(stateRoot)), { recursive: true });
    fs.writeFileSync(overridesPathFor(stateRoot), "{corrupt", "utf8");

    const { assertions, warning } = loadUserAssertions(stateRoot);
    expect(assertions.size).toBe(0);
    expect(warning).toContain("provenance.json");

    saveUserAssertion(stateRoot, "new", {
      repository: "x/y",
      assertedAt: "2026-07-27T10:00:00.000Z",
    });
    expect(fs.existsSync(`${overridesPathFor(stateRoot)}.bak`)).toBe(true);
    expect(loadUserAssertions(stateRoot).assertions.has("new")).toBe(true);
  });

  it("fails closed on future schema versions without destroying the file", () => {
    fs.mkdirSync(path.dirname(overridesPathFor(stateRoot)), { recursive: true });
    fs.writeFileSync(
      overridesPathFor(stateRoot),
      JSON.stringify({ schema: 99, skills: { x: {} } }),
      "utf8",
    );
    const { assertions, warning } = loadUserAssertions(stateRoot);
    expect(assertions.size).toBe(0);
    expect(warning).toContain("version");
  });
});
