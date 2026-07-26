/**
 * Ownership classes (ARCHITECTURE.md, "Uninstall Model"):
 *
 * - skillvault-owned: created by a committed SkillVault transaction.
 * - officially-owned: documented by a verified adapter recipe; the recipe
 *   subsystem is deferred, so the MVP never auto-acts on this class.
 * - user-owned: known pre-existing or explicitly retained content.
 * - unknown: ownership cannot be established.
 *
 * Two documented rules are encoded here so planners cannot drift from them:
 * only SkillVault-owned artifacts may be removed automatically, and any
 * unmanaged (non-SkillVault-owned) content must be backed up before it is
 * replaced or deleted.
 */

export const OWNERSHIP_CLASSES = [
  "skillvault-owned",
  "officially-owned",
  "user-owned",
  "unknown",
] as const;

export type OwnershipClass = (typeof OWNERSHIP_CLASSES)[number];

export function isAutoRemovable(ownership: OwnershipClass): boolean {
  return ownership === "skillvault-owned";
}

export function requiresBackupBeforeMutation(
  ownership: OwnershipClass,
): boolean {
  return !isAutoRemovable(ownership);
}
