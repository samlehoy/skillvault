# SkillVault Product Definition

## Status

This document is the living source of truth for SkillVault's product goals and scope. It describes the intended MVP, not current implementation status.

## Problem

AI agent skills are commonly installed independently for each agent IDE and at both global and project scopes. Over time, users accumulate duplicated directories, unknown origins, outdated revisions, conflicting instructions, broken links, and skills that are no longer used. Existing installations are difficult to reproduce on another machine or share with collaborators.

## Product Statement

SkillVault is a local-first terminal user interface that provides one source of truth for AI agent skills and synchronizes an effective skill set across supported agent IDEs at global and project scopes.

SkillVault manages skill files, versions, provenance, and installation state. It does not execute skills or judge whether their instructions are useful or correct.

## Positioning

Skill installers already exist — notably the vercel-labs `skills` CLI (`npx skills`), which maintains a global store under `~/.agents/skills` and an install lockfile with source metadata. SkillVault is not another installer. Its differentiation is:

- Committed per-project manifests and lockfiles that reproduce the same effective skill set on another machine.
- Drift auditing between desired, resolved, and actual target state.
- Ownership-aware, reviewable uninstall instead of manual deletion.
- Explicit provenance confidence with user correction.
- An inventory-centric TUI spanning global and project scopes across multiple agent IDEs.

SkillVault interoperates with installer output at import time: skills previously installed by third-party installers are discovered as unmanaged local skills, and installer lock metadata is imported as Declared provenance evidence. After import, SkillVault expects to be the single manager of its managed skills.

## Target Users

- Developers who use more than one agent IDE.
- Teams that want reproducible project-specific agent skills.
- Users who need to clean up existing skill installations without blindly deleting files.
- Skill authors who test local skills across multiple supported tools.

## North Star

Given the same project manifest and lockfile, SkillVault can reproduce the same effective skill set and verify zero drift across every supported target installation.

Conceptually:

```text
desired state = resolved state
resolved state = actual target state
drift = 0
```

## MVP Goals

### TUI-first management

The primary MVP experience is an inventory-centric TUI. It provides:

- A dashboard and filterable skill inventory.
- Skill detail views with scope, target installations, health, version, and source provenance.
- Guided discovery and import on first run.
- Reviewable plans for batch import, synchronization, update, and uninstall.
- Audit findings and remediation actions.
- Keyboard-oriented navigation and an action palette.

### Reusable local core

Discovery, resolution, auditing, Git operations, planning, transactions, and adapter behavior live in a headless core rather than TUI screens. The shipped executable may expose a small set of headless recovery and automation commands such as scan, audit, sync, and doctor. Full CLI parity is not an MVP goal.

### Canonical vault

- Store each managed skill once in a canonical local vault.
- Use a directory containing `SKILL.md` as the canonical baseline.
- Connect native agent IDE skill directories to the vault instead of maintaining unmanaged copies.
- Prefer directory junctions on Windows and design the boundary to support symbolic links on other platforms later.

### Global and project scopes

- Maintain global desired state and optional project desired state.
- Let project declarations override global declarations with the same canonical skill ID.
- Let a project disable an otherwise global skill.
- Commit project manifests and lockfiles so collaborators can reproduce the resolved setup.

### Local and Git sources

- Accept local skill directories and Git repositories.
- Support a skill at a repository root or an explicit repository subdirectory.
- Pin Git skills to commit SHAs in a lockfile.
- Delegate private repository authentication to the user's existing Git credential helper or SSH agent.
- Review upstream changes before moving a pinned revision.
- Discover skills installed by third-party installers (for example `npx skills`) as local unmanaged candidates; import their installer lock metadata (such as `~/.agents/.skill-lock.json`) as Declared provenance. The npm registry itself is not a source type in the MVP.

### Provenance

Display a source repository link when one can be established. Every displayed source has a confidence label:

- **Verified:** established from a SkillVault manifest, lockfile, or verified Git checkout metadata.
- **Declared:** provided by skill metadata or a third-party installer lockfile but not independently verified.
- **Inferred:** derived from local evidence and presented as a candidate, never as fact.
- **Unknown:** no defensible source is available.
- **User-verified:** explicitly corrected or confirmed by the user.

Users can edit unknown or incorrect provenance. Project-relevant corrections are stored in the manifest so collaborators receive the same source declaration. SkillVault must not search GitHub by skill name and silently attribute a repository.

### Discovery and safe import

- Detect supported agent IDE installations and their existing skills.
- Group exact duplicates and flag deterministic duplicate candidates.
- Present an import plan before taking ownership or replacing existing directories with managed links.
- Block same-ID, different-content conflicts until the user chooses a canonical source or a new ID.
- Never perform automatic first-run takeover.

### Auditing

The MVP reports:

- Git revisions behind their tracked upstream reference.
- Exact content duplicates.
- Deterministic likely-duplicate candidates based on identity, source, and content evidence.
- Skills unreferenced by any known manifest or target.
- Global/project conflicts and intentional project shadowing.
- Broken or redirected links.
- Target content that has drifted from resolved state.
- Manifest and lockfile disagreement.
- Missing, stale, or unavailable provenance verification.

Likely duplicates are findings for user review. SkillVault does not automatically merge or delete them.

### Safe uninstall

Uninstall is ownership-aware and follows this default policy:

1. Remove artifacts that SkillVault owns.
2. Scan for residual artifacts after the managed removal.
3. Offer an explicit clean action for verified residuals.
4. Preserve unknown files unless the user reviews and explicitly approves their removal.

An official adapter uninstall recipe subsystem (executing an IDE's documented uninstall behavior with verified freshness metadata) is deferred until after the MVP.

Removing a skill from one project or target does not imply deleting it from the vault. Vault deletion is blocked while another scope or target still references the skill unless the user approves the complete dependent removal plan.

### Safe mutation

- Preview every mutating batch as a consolidated plan.
- Show effects per skill, scope, target installation, and filesystem path.
- Back up unmanaged content before replacement or deletion.
- Apply changes transactionally where the filesystem permits.
- Verify post-conditions and roll back partial failures.
- Keep transaction records that support explicit rollback.
- Prevent concurrent mutating operations with a local lock.

### Offline-first behavior

Local inventory, local audits, managed synchronization, and safe managed uninstall remain available offline. Remote source verification, update checks, and official recipe freshness may become unavailable or stale; the TUI must label that state without pretending cached information is current.

## Supported Targets

The MVP acceptance target includes:

- OpenCode
- Antigravity
- Claude Code
- Codex

Delivery is phased. OpenCode is the reference adapter. Antigravity follows immediately after the first vertical slice to validate the adapter contract against a structurally different IDE. Claude Code and Codex follow once the core feature set is complete. A target's paths, formats, and official uninstall behavior must be documented from verified installation behavior or official documentation before its adapter is considered supported.

A declarative custom adapter may configure paths and required files. Arbitrary executable third-party plugins are outside the MVP.

## Minimal Headless Operations

The TUI is the primary product, but the executable should expose a small stable set of non-interactive operations for recovery, testing, and basic automation:

- Scan/discover local state.
- Audit without mutation.
- Synchronize an already resolved configuration with explicit approval flags.
- Diagnose configuration, permissions, links, and adapter health.

The MVP command set is `scan`, `audit`, `sync`, and `doctor`. All support `--json` machine-readable output; `sync` requires an explicit `--yes` approval flag.

These operations consume the same core as the TUI. A comprehensive standalone CLI is deferred.

## Distribution

SkillVault is open source under the MIT license and is distributed as an npm package running on Node LTS (`npx @samlehoy/skillvault`). The repository is public from the start of development, and public 0.x releases begin with the first working vertical slice.

## Non-goals

The MVP does not include:

- A desktop GUI or browser dashboard.
- A hosted marketplace or central skill registry.
- The npm registry as a skill source type.
- An official adapter uninstall recipe subsystem (deferred until after the MVP).
- User accounts, cloud state, or cloud synchronization.
- A background monitoring daemon.
- Automatic unattended updates.
- Semantic duplicate detection using an LLM or embeddings.
- A dependency resolver between skills.
- Executable third-party adapter plugins or arbitrary lifecycle hooks.
- Automatic conflict merging.
- Evaluation, ranking, or execution of skill instructions.
- Advanced supply-chain or behavioral security analysis.
- Production-grade support for every operating system.

## MVP Acceptance Criteria

1. The Windows-first TUI can discover verified installations of all four target agent IDEs.
2. First run presents existing skills and a reviewable import plan without mutating the filesystem.
3. A canonical managed skill is stored once and connected to selected target installations.
4. Global and project manifests resolve deterministically with project precedence.
5. A Git skill resolves to a locked commit and can be reproduced from a committed project manifest and lockfile.
6. The inventory displays provenance with an explicit confidence label and permits user correction.
7. Audit detects outdated, duplicate, unused, conflicting, broken, and drifted state without destructive remediation.
8. Batch synchronization, update, and uninstall display a consolidated plan before applying changes.
9. Default uninstall safely removes SkillVault-owned artifacts, preserves unknown files, and offers a reviewed clean action for verified residuals.
10. Failed mutations restore the previous valid state or clearly report any operation that could not be rolled back.
11. Local management remains useful offline and labels remote information as unavailable or stale.
12. Minimal headless commands use the same core behavior as the TUI.

## Documentation Policy

Changes that alter product behavior or scope must update this document in the same change. Implementation details belong in `ARCHITECTURE.md`; delivery sequencing belongs in `IMPLEMENTATION_PLAN.md`. Significant tradeoffs that need historical context should be captured as ADRs under `docs/decisions/` when they arise.
