import { describe, expect, it } from "vitest";
import { parseManifest, type Manifest } from "./manifest.js";
import { resolveEffective } from "./resolve.js";
import { findCollisions } from "./skill-id.js";
import {
  collidingRawIds,
  globalManifestData,
  invalidManifestFixtures,
  projectAManifestData,
  projectBManifestData,
} from "./fixtures.js";

/**
 * Cross-fixture verification for the M1 exit criteria: identical inputs
 * always produce identical effective skills, source intents, and target
 * intents, and every domain error is structured and renderable.
 */

function mustParse(data: unknown): Manifest {
  const result = parseManifest(data);
  if (!result.ok) {
    throw new Error(`fixture failed to parse: ${JSON.stringify(result.errors)}`);
  }
  return result.manifest;
}

/** Rebuilds an object with reversed key insertion order, recursively. */
function reversedKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reversedKeys) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .reverse()
        .map(([key, entry]) => [key, reversedKeys(entry)]),
    ) as T;
  }
  return value;
}

describe("fixture manifests", () => {
  it("parse successfully", () => {
    expect(parseManifest(globalManifestData).ok).toBe(true);
    expect(parseManifest(projectAManifestData).ok).toBe(true);
    expect(parseManifest(projectBManifestData).ok).toBe(true);
  });

  it.each(invalidManifestFixtures.map((f) => [f.name, f] as const))(
    "rejects %s with a structured, renderable error",
    (_name, fixture) => {
      const result = parseManifest(fixture.data);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.map((e) => e.code)).toContain(
          fixture.expectedCode,
        );
        for (const error of result.errors) {
          expect(error.code).not.toBe("");
          expect(error.message).not.toBe("");
          expect(Array.isArray(error.path)).toBe(true);
        }
      }
    },
  );
});

describe("resolution across multiple projects", () => {
  const global = mustParse(globalManifestData);
  const projectA = mustParse(projectAManifestData);
  const projectB = mustParse(projectBManifestData);

  it("applies project A overrides, additions, and disables", () => {
    const { skills, findings } = resolveEffective(global, projectA);
    expect(skills.map((s) => s.id)).toEqual([
      "code-review",
      "sql-review",
      "web2md",
    ]);

    const web2md = skills.find((s) => s.id === "web2md")!;
    expect(web2md.scope).toBe("project");
    expect(web2md.overridesGlobal).toBe(true);
    expect(web2md.declaration.source).toEqual({
      type: "git",
      repository: "https://github.com/acme-fork/skills.git",
      subdir: "web2md",
      ref: "v2",
    });

    const sqlReview = skills.find((s) => s.id === "sql-review")!;
    expect(sqlReview.declaration.targets).toEqual(["opencode-proj-a"]);

    expect(findings.map((f) => f.code)).toEqual(["resolve/project-shadowing"]);
  });

  it("reports a disable without a global declaration in project B", () => {
    const { skills, findings } = resolveEffective(global, projectB);
    expect(skills.map((s) => s.id)).toEqual([
      "code-review",
      "release-notes",
      "web2md",
    ]);
    expect(findings.map((f) => f.code)).toEqual([
      "resolve/disable-without-global",
    ]);
  });

  it("keeps each project isolated from the other's overrides", () => {
    const a = resolveEffective(global, projectA);
    const b = resolveEffective(global, projectB);
    const bWeb2md = b.skills.find((s) => s.id === "web2md")!;
    expect(bWeb2md.scope).toBe("global");
    expect(bWeb2md.declaration).toEqual(
      globalManifestData.skills["web2md"],
    );
    expect(a.skills.find((s) => s.id === "release-notes")).toBeUndefined();
    expect(b.skills.find((s) => s.id === "release-notes")).toBeDefined();
  });
});

describe("determinism (M1 exit criteria)", () => {
  it("produces identical resolutions when manifest key order is reversed", () => {
    const baseline = resolveEffective(
      mustParse(globalManifestData),
      mustParse(projectAManifestData),
    );
    const shuffled = resolveEffective(
      mustParse(reversedKeys(globalManifestData)),
      mustParse(reversedKeys(projectAManifestData)),
    );
    expect(shuffled).toEqual(baseline);
  });

  it("reports identical collisions regardless of raw input order", () => {
    const baseline = findCollisions([...collidingRawIds]);
    const reversed = findCollisions([...collidingRawIds].reverse());
    expect(reversed).toEqual(baseline);
    expect(baseline).toHaveLength(1);
    expect(baseline[0]!.id).toBe("code-review");
  });
});
