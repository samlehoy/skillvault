# ADR-0001: Rename the project from SkillVault to SkillKeep

- Status: accepted
- Date: 2026-07-26

## Context

The distribution channel is `npx <name>`. The npm package name `skillvault` is owned by an active commercial product ("SkillVault — secure skill distribution for Claude Code", getskillvault.com, v0.13.x as of April 2026) operating in the same domain: agent skill distribution. Reusing the name invites user confusion and trademark risk for a public open-source project.

## Decision

Rename the project to **SkillKeep**. The npm name `skillkeep` was verified available on 2026-07-26. Repository, binary, documentation, config directory (`~/.skillkeep/`), and project directory (`.skillkeep/`) all use the new name.

## Consequences

- All documentation and future code use SkillKeep.
- The local working folder may still be named `SkillVault` until the repository is created; the GitHub repository must be created as `skillkeep`.
- The npm name should be claimed early with a placeholder release.
