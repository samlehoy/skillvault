import { describe, expect, it } from "vitest";
import {
  isAutoRemovable,
  OWNERSHIP_CLASSES,
  requiresBackupBeforeMutation,
} from "./ownership.js";

describe("ownership classes", () => {
  it("enumerates exactly the four documented classes", () => {
    expect(OWNERSHIP_CLASSES).toEqual([
      "skillkeep-owned",
      "officially-owned",
      "user-owned",
      "unknown",
    ]);
  });
});

describe("isAutoRemovable", () => {
  it("allows automatic removal only for skillkeep-owned artifacts", () => {
    expect(isAutoRemovable("skillkeep-owned")).toBe(true);
  });

  it.each([
    ["officially-owned"], // requires the deferred recipe subsystem, not in MVP
    ["user-owned"], // known pre-existing or explicitly retained content
    ["unknown"], // unknown files are never silently deleted
  ] as const)("refuses automatic removal for %s content", (cls) => {
    expect(isAutoRemovable(cls)).toBe(false);
  });
});

describe("requiresBackupBeforeMutation", () => {
  it("does not require a backup for skillkeep-owned artifacts", () => {
    expect(requiresBackupBeforeMutation("skillkeep-owned")).toBe(false);
  });

  it.each([
    ["officially-owned"],
    ["user-owned"],
    ["unknown"],
  ] as const)("requires a backup before replacing or deleting %s content", (cls) => {
    expect(requiresBackupBeforeMutation(cls)).toBe(true);
  });
});
