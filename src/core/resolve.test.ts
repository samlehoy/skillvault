import { describe, expect, it } from "vitest";
import type { Manifest } from "./manifest.js";
import { resolveEffective } from "./resolve.js";

const git = (repo: string) => ({
  source: { type: "git" as const, repository: repo },
});

const globalManifest: Manifest = {
  schema: 1,
  skills: {
    "code-review": git("https://github.com/g/code-review.git"),
    tdd: git("https://github.com/g/tdd.git"),
    "noisy-skill": git("https://github.com/g/noisy.git"),
  },
};

describe("resolveEffective", () => {
  it("returns global skills when no project manifest exists", () => {
    const result = resolveEffective(globalManifest);
    expect(result.skills.map((s) => s.id)).toEqual([
      "code-review",
      "noisy-skill",
      "tdd",
    ]);
    expect(result.skills.every((s) => s.scope === "global")).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("applies effective(project) = global + overrides - disables", () => {
    const project: Manifest = {
      schema: 1,
      skills: {
        "code-review": git("https://github.com/p/better-code-review.git"),
        "noisy-skill": { disabled: true },
        "project-only": git("https://github.com/p/project-only.git"),
      },
    };
    const result = resolveEffective(globalManifest, project);

    expect(result.skills.map((s) => s.id)).toEqual([
      "code-review",
      "project-only",
      "tdd",
    ]);

    const codeReview = result.skills.find((s) => s.id === "code-review");
    expect(codeReview?.scope).toBe("project");
    expect(codeReview?.overridesGlobal).toBe(true);
    if (codeReview && "source" in codeReview.declaration) {
      expect(codeReview.declaration.source.type === "git" &&
        codeReview.declaration.source.repository).toBe(
        "https://github.com/p/better-code-review.git",
      );
    }

    const projectOnly = result.skills.find((s) => s.id === "project-only");
    expect(projectOnly?.scope).toBe("project");
    expect(projectOnly?.overridesGlobal).toBe(false);
  });

  it("reports intentional project shadowing as a finding, not an error", () => {
    const project: Manifest = {
      schema: 1,
      skills: { tdd: git("https://github.com/p/tdd.git") },
    };
    const result = resolveEffective(globalManifest, project);
    expect(result.findings).toEqual([
      expect.objectContaining({ code: "resolve/project-shadowing", id: "tdd" }),
    ]);
  });

  it("reports disabling a skill that is not declared globally", () => {
    const project: Manifest = {
      schema: 1,
      skills: { ghost: { disabled: true } },
    };
    const result = resolveEffective(globalManifest, project);
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: "resolve/disable-without-global",
        id: "ghost",
      }),
    ]);
  });

  it("reports and ignores disabled entries in the global manifest", () => {
    const withGlobalDisable: Manifest = {
      schema: 1,
      skills: { odd: { disabled: true } },
    };
    const result = resolveEffective(withGlobalDisable);
    expect(result.skills).toEqual([]);
    expect(result.findings).toEqual([
      expect.objectContaining({ code: "resolve/disable-in-global", id: "odd" }),
    ]);
  });

  it("is deterministic regardless of declaration order", () => {
    const shuffled: Manifest = {
      schema: 1,
      skills: {
        tdd: globalManifest.skills["tdd"]!,
        "noisy-skill": globalManifest.skills["noisy-skill"]!,
        "code-review": globalManifest.skills["code-review"]!,
      },
    };
    expect(resolveEffective(shuffled)).toEqual(
      resolveEffective(globalManifest),
    );
  });
});
