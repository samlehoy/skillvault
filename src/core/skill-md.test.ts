import { describe, expect, it } from "vitest";
import { checkIdAlignment, parseSkillMd } from "./skill-md.js";

const valid = `---
name: code-review
description: Review changes for standards and spec compliance.
---

# Code review

Do the review.
`;

describe("parseSkillMd", () => {
  it("parses name, description, and body from a valid skill", () => {
    const result = parseSkillMd(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skill.name).toBe("code-review");
      expect(result.skill.description).toBe(
        "Review changes for standards and spec compliance.",
      );
      expect(result.skill.body).toContain("Do the review.");
    }
  });

  it("preserves unknown frontmatter keys as extra metadata without failing", () => {
    const result = parseSkillMd(`---
name: a
description: b
license: MIT
metadata:
  author: someone
---
body
`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.skill.extra).toEqual({
        license: "MIT",
        metadata: { author: "someone" },
      });
    }
  });

  it("rejects content without frontmatter", () => {
    const result = parseSkillMd("# just markdown\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("skill-md/no-frontmatter");
    }
  });

  it("rejects an unterminated frontmatter block", () => {
    const result = parseSkillMd("---\nname: a\ndescription: b\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("skill-md/no-frontmatter");
    }
  });

  it("rejects invalid YAML in frontmatter", () => {
    const result = parseSkillMd("---\nname: [unclosed\n---\nbody\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("skill-md/invalid-yaml");
    }
  });

  it("rejects a missing name", () => {
    const result = parseSkillMd("---\ndescription: b\n---\nbody\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path[0] === "name")).toBe(true);
    }
  });

  it("rejects a non-canonical name", () => {
    const result = parseSkillMd("---\nname: Code Review\ndescription: b\n---\nbody\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path[0] === "name")).toBe(true);
    }
  });

  it("rejects a missing or empty description", () => {
    const result = parseSkillMd("---\nname: a\ndescription: ''\n---\nbody\n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path[0] === "description")).toBe(true);
    }
  });

  it("rejects an empty body", () => {
    const result = parseSkillMd("---\nname: a\ndescription: b\n---\n   \n");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.code).toBe("skill-md/empty-body");
    }
  });

  it("accepts CRLF line endings", () => {
    const result = parseSkillMd(
      "---\r\nname: a\r\ndescription: b\r\n---\r\nbody\r\n",
    );
    expect(result.ok).toBe(true);
  });
});

describe("checkIdAlignment", () => {
  it("returns no findings when everything matches", () => {
    expect(
      checkIdAlignment("code-review", {
        frontmatterName: "code-review",
        directoryName: "code-review",
      }),
    ).toEqual([]);
  });

  it("reports frontmatter name mismatch as a finding, not an error", () => {
    const findings = checkIdAlignment("code-review", {
      frontmatterName: "review-code",
      directoryName: "code-review",
    });
    expect(findings).toEqual([
      expect.objectContaining({
        code: "skill-md/name-mismatch",
        id: "code-review",
      }),
    ]);
  });

  it("reports directory name mismatch", () => {
    const findings = checkIdAlignment("code-review", {
      frontmatterName: "code-review",
      directoryName: "Code Review",
    });
    expect(findings).toEqual([
      expect.objectContaining({ code: "skill-md/directory-mismatch" }),
    ]);
  });
});
