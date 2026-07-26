import { describe, expect, it } from "vitest";
import { findCollisions, normalizeSkillId } from "./skill-id.js";

describe("normalizeSkillId", () => {
  it("returns lowercase kebab-case ids unchanged", () => {
    expect(normalizeSkillId("code-review")).toEqual({
      ok: true,
      id: "code-review",
    });
  });

  it.each([
    ["Code Review", "code-review"],
    ["code_review", "code-review"],
    ["CODE.REVIEW", "code-review"],
    ["  code review  ", "code-review"],
    ["code--review", "code-review"],
    ["-code-review-", "code-review"],
    ["Code Review v2", "code-review-v2"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeSkillId(input)).toEqual({ ok: true, id: expected });
  });

  it("keeps digits", () => {
    expect(normalizeSkillId("web2md")).toEqual({ ok: true, id: "web2md" });
  });

  it.each([
    [""],
    ["   "],
    ["---"],
    ["!!!"],
  ])("rejects input %j that normalizes to nothing", (input) => {
    const result = normalizeSkillId(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("skill-id/empty");
      expect(result.error.input).toBe(input);
    }
  });

  it("is idempotent", () => {
    const once = normalizeSkillId("Code Review v2");
    expect(once.ok).toBe(true);
    if (once.ok) {
      expect(normalizeSkillId(once.id)).toEqual(once);
    }
  });
});

describe("findCollisions", () => {
  it("reports distinct raw ids that normalize to the same canonical id", () => {
    const collisions = findCollisions(["Code Review", "code_review", "tdd"]);
    expect(collisions).toEqual([
      { id: "code-review", inputs: ["Code Review", "code_review"] },
    ]);
  });

  it("does not report exact duplicates of the same raw string as a collision", () => {
    expect(findCollisions(["tdd", "tdd"])).toEqual([]);
  });

  it("returns an empty list when all ids are distinct", () => {
    expect(findCollisions(["a", "b", "c"])).toEqual([]);
  });

  it("is deterministic regardless of input order", () => {
    const a = findCollisions(["code_review", "Code Review", "b_x", "b-x"]);
    const b = findCollisions(["b-x", "Code Review", "b_x", "code_review"]);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => [...c.inputs].sort())).toEqual(
      b.map((c) => [...c.inputs].sort()),
    );
  });

  it("skips unnormalizable inputs instead of throwing", () => {
    expect(findCollisions(["!!!", "tdd"])).toEqual([]);
  });
});
