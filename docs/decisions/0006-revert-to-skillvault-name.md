# ADR-0006: Revert the project name to SkillVault, distribute as a scoped npm package

- Status: accepted (supersedes ADR-0001)
- Date: 2026-07-26

## Context

ADR-0001 renamed the project to SkillKeep because the unscoped npm name `skillvault` belongs to an active commercial product in the same domain. The owner subsequently decided the project keeps its original SkillVault identity: the GitHub repository is `samlehoy/skillvault`, and a mixed identity (repo `skillvault`, product/npm `skillkeep`) left confusing remnants throughout the codebase.

## Decision

- Product name: **SkillVault** everywhere (documentation, code, ownership class `skillvault-owned`, config directories `~/.skillvault/` and `.skillvault/`).
- npm package: **`@samlehoy/skillvault`** (scoped, `publishConfig.access: public`), because the unscoped name is taken. Installed command name: `skillvault`.
- The naming-confusion and trademark-proximity risk versus the unrelated commercial SkillVault product (getskillvault.com) was raised twice and is consciously accepted by the owner.

## Consequences

- `npx @samlehoy/skillvault` is the install/run channel; after global install the command is `skillvault`.
- ADR-0001 is retained as history; its rationale about the unscoped npm name remains factually correct and is addressed by scoping instead of renaming.
- All prior SkillKeep references in living documents and code were replaced in the same change that adopted this ADR.
