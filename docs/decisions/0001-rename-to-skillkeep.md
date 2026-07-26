# ADR-0001: Rename the project from SkillVault to SkillKeep

- Status: accepted
- Date: 2026-07-26

## Context

The distribution channel is `npx <name>`. The npm package name `skillvault` is owned by an active commercial product ("SkillVault — secure skill distribution for Claude Code", getskillvault.com, v0.13.x as of April 2026) operating in the same domain: agent skill distribution. Reusing the name invites user confusion and trademark risk for a public open-source project.

## Decision

Rename the project to **SkillKeep**. The npm name `skillkeep` was verified available on 2026-07-26. Repository, binary, documentation, config directory (`~/.skillkeep/`), and project directory (`.skillkeep/`) all use the new name.

## Consequences

- All documentation and future code use SkillKeep.
- The npm name should be claimed early with a placeholder release.

## Amendment (2026-07-26)

At the owner's preference, the GitHub repository is named `skillvault` (https://github.com/samlehoy/skillvault) while the product and npm package remain **SkillKeep** / `skillkeep`. The owner accepts the repo/package name mismatch and the proximity to the unrelated commercial SkillVault product; this amendment records that the risk was raised and consciously accepted.
