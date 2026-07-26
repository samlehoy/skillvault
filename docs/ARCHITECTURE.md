# SkillKeep Architecture

## Status

This document is the living source of truth for the proposed SkillKeep architecture. The implementation stack is selected (see Implementation Stack). It intentionally avoids unverified agent IDE paths and commands. Adapter-specific facts must be confirmed against an installed version or official documentation before implementation.

## Architectural Drivers

- TUI-first user experience without coupling domain behavior to a TUI framework.
- Reproducible resolution from manifests and lockfiles.
- One canonical copy of each managed skill.
- Safe adoption of unmanaged existing installations.
- Explicit provenance and confidence rather than guessed attribution.
- Reviewable and reversible filesystem mutation.
- Windows-first implementation with portable core boundaries.
- Useful local behavior without a network connection.

## Implementation Stack

- **Language:** TypeScript, compatible with Node LTS (>= 20). Bun may be used for local development, but CI and the published package target Node.
- **TUI:** Ink (React-based), rendering typed requests and responses from the core.
- **Validation:** Zod schemas for manifests, lockfiles, and local state.
- **Testing:** Vitest for unit, contract, and integration tests.
- **Git:** shell out to the system `git` executable. Authentication stays delegated to the user's Git credential helper and SSH agent; `doctor` verifies Git availability.
- **Windows links:** directory junctions created and inspected through Node's built-in `fs` junction support; no elevation required.
- **Distribution:** npm package (`npx skillkeep`), MIT licensed. No native binaries or code signing in the MVP.

## System Context

```text
                         Git repositories
                                |
                                v
+----------------+      +--------------------+
| TUI            |----->| SkillKeep core    |
| inventory      |      |                    |
| detail         |      | discovery          |
| plan review    |      | resolution         |
| progress       |      | provenance         |
| recovery       |      | audit              |
+----------------+      | planning           |
                        | transactions        |
+----------------+      | adapters           |
| Minimal        |----->|                    |
| headless cmds  |      +---------+----------+
+----------------+                |
                                  v
                    local vault and agent IDE targets
```

The TUI and minimal headless commands are delivery mechanisms. They request operations from the core and render typed results, plans, progress events, and diagnostics. They do not directly manipulate target directories.

## Core Boundaries

### Inventory and discovery

Discovery identifies:

- Installed and configured agent IDE instances.
- The canonical path of each distinct target installation.
- Existing native skill directories and managed links.
- Project roots and project-specific skill configuration.
- Local Git evidence that may establish provenance.

An installation is identified by adapter ID plus canonical target path. CLI and desktop variants of the same agent IDE are one installation when they share a target directory and separate installations when their canonical directories differ.

Discovery is read-only. It may produce import candidates but cannot take ownership.

### Desired-state resolution

Resolution combines global and project declarations:

```text
effective(project) = global + project overrides - project disables
```

A canonical skill ID is normalized to lowercase kebab-case. Normalization can identify a collision candidate, but it cannot merge two skills automatically.

Resolution produces a deterministic effective set for a project and selected target installations. The resolver does not inspect TUI state and does not access the filesystem except through explicit source and inventory inputs.

### Source resolution and locking

The desired-state manifest expresses intent (`.skillkeep/skills.yaml`, committed, human-edited). A separate lockfile records reproducible results (`.skillkeep/skills.lock.json`, committed, machine-written).

Conceptual manifest:

```yaml
schema: 1

skills:
  code-review:
    source:
      type: git
      repository: https://github.com/example/agent-skills.git
      subdir: skills/code-review
      ref: main
    targets:
      - opencode
      - claude-code
```

Conceptual lock entry:

```json
{
  "schema": 1,
  "skills": {
    "code-review": {
      "source": {
        "type": "git",
        "repository": "https://github.com/example/agent-skills.git",
        "subdir": "skills/code-review"
      },
      "resolved": {
        "commit": "56c4f8b8d7d42fc6d30f5369759b28f10ad12abc",
        "contentHash": "sha256:example"
      }
    }
  }
}
```

The tracked ref is used to check for updates. Installation uses the locked commit. Machine-specific absolute local paths belong in local state, not in a committed project lockfile.

Private Git authentication is delegated to Git credential helpers and SSH agents. SkillKeep does not store access tokens or private keys.

### Canonical skill model

The canonical baseline is a directory containing `SKILL.md`, with optional supporting directories such as `references`, `scripts`, and `assets`.

The manifest-assigned canonical ID is authoritative. Frontmatter and directory names are metadata and validation inputs. Adapter-specific wrappers or metadata are derived views and must not mutate canonical source content.

The MVP has no dependency resolver. A skill is resolved and installed as one unit.

### Provenance

Provenance is structured data, not an unlabelled URL:

```text
source type
repository URL, when present
repository subdirectory, when present
tracked ref, when present
resolved commit, when present
evidence
confidence
last verification result and time
```

Confidence states are Verified, Declared, Inferred, Unknown, and User-verified. Only Verified and User-verified provenance may automatically drive update source selection. Declared or Inferred provenance requires confirmation before it becomes authoritative.

Evidence can include:

- A committed manifest and matching lockfile.
- Git remote and commit metadata from a known checkout.
- Source metadata declared in `SKILL.md`.
- A third-party installer lockfile, such as `~/.agents/.skill-lock.json` written by the vercel-labs `skills` CLI, imported as Declared evidence; re-verification against the declared repository can upgrade it to Verified.
- A user correction.

Name-only GitHub search is not sufficient evidence. When offline, cached provenance retains its original confidence but carries an unavailable or stale verification status.

### Audit engine

Audit compares desired, resolved, and actual state. Findings have stable codes, severity, evidence, affected skill and installation IDs, and suggested remediation.

Audit categories include:

- Outdated tracked Git references.
- Manifest-lock mismatch.
- Exact duplicates by normalized content hash.
- Likely duplicates using deterministic identity, source, and content signals.
- Unused canonical entries.
- Global/project collisions and intentional shadowing.
- Missing, broken, or redirected links.
- Native target content different from resolved content.
- Unknown, unavailable, or stale provenance.

Audit never performs remediation as a side effect.

### Planning

Every mutating operation first produces an immutable plan. A plan contains:

- Preconditions used to calculate it.
- Exact manifest, lockfile, vault, and target operations.
- Ownership classification for every affected path.
- Backup requirements.
- Scope and installation effects.
- Operations that are reversible and any known rollback limitation.
- Expected post-conditions.

Batch operations aggregate per-skill actions into one reviewable plan. Applying a stale plan is rejected when relevant preconditions have changed.

### Transactions and rollback

Mutation follows this lifecycle:

```text
inspect -> resolve -> plan -> confirm -> lock -> stage -> apply -> verify -> record
                                                 |
                                                 +-> rollback on failure
```

The transaction system:

- Acquires an exclusive local mutation lock.
- Backs up unmanaged content before replacement or deletion.
- Stages new canonical content before changing target links.
- Records each applied operation and its inverse where possible.
- Verifies resolved and actual state after application.
- Automatically attempts rollback after partial failure.
- Retains enough information for user-requested rollback.

No architecture can guarantee atomicity across every filesystem and external official command. Plans and transaction records must explicitly identify such boundaries rather than claiming false atomicity.

## Vault and Link Model

Global state lives under `~/.skillkeep/`, following the dotfolder convention used by the agent IDE ecosystem itself:

- `config.yaml`: global desired state and user settings.
- `vault/`: immutable resolved skill revisions.
- `cache/git/`: Git objects and checkouts used for resolution.
- `state/`: discovered installations, machine-specific paths, and ownership records (JSON).
- `backups/`: pre-mutation backups and transaction records.
- `locks/`: process locks.

Project configuration lives in a committed `.skillkeep/` directory at the project root: `skills.yaml` (manifest) and `skills.lock.json` (lockfile). Machine-specific absolute paths never enter committed files.

On Windows, managed target directories prefer directory junctions because they usually avoid elevated symlink requirements. The filesystem abstraction must preserve link type and target identity so symbolic links can be used on supported Unix platforms later.

A fallback to unmanaged copies is not part of the default model because it recreates drift. If a target cannot consume a managed link, that limitation is surfaced rather than silently changing storage semantics.

## Adapter Model

An adapter encapsulates verified behavior for one agent IDE. Conceptually it provides:

- Installation discovery.
- Global and project target resolution.
- Canonical skill compatibility validation.
- Install and removal planning.
- Actual-state inspection.
- An optional official uninstall recipe with source and freshness metadata (post-MVP).

OpenCode is the reference adapter. Antigravity is the second adapter and validates the contract against a structurally different IDE. Claude Code and Codex follow once the core feature set is complete. No concrete target paths or official commands are architectural facts until verified.

### Configurable adapters

The MVP may support declarative custom adapters with:

- Explicit global and project paths.
- Link naming rules.
- Required canonical files.
- Read-only discovery and standard managed-link operations.

Custom adapters cannot execute arbitrary hooks or claim an official uninstall recipe without verified metadata.

### Official recipe metadata (post-MVP)

The official uninstall recipe subsystem is deferred until after the MVP; the MVP uninstalls through ownership-based managed removal only. When introduced, an official uninstall recipe records:

- Target adapter and compatible version range.
- Source documentation URL.
- Documentation or recipe revision.
- Date last verified.
- Preconditions.
- Operations or official command to invoke.
- Expected artifacts removed and retained.
- Post-uninstall inspection rules.

A recipe that does not match the detected installation or whose evidence is unavailable is shown as stale or inapplicable. SkillKeep then falls back to an ownership-based managed removal plan, not a guessed command.

## Uninstall Model

Uninstall separates scope removal, target removal, and canonical deletion.

### Ownership classes

- **SkillKeep-owned:** created by a committed SkillKeep transaction.
- **Officially owned:** documented as belonging to the skill or target by an applicable verified adapter recipe. Not used by the MVP; requires the deferred recipe subsystem.
- **User-owned:** known pre-existing or explicitly retained content.
- **Unknown:** ownership cannot be established.

### Default flow

```text
build uninstall intent
  -> check remaining scope and target references
  -> plan removal of SkillKeep-owned artifacts
  -> back up affected unmanaged content
  -> apply and verify
  -> scan residuals
  -> offer reviewed safe-clean plan
```

Unknown files are never silently deleted. “Clean” means remove verified residuals after preview; it does not mean recursively delete every plausible directory. A force-delete capability, if ever introduced, is an explicit advanced operation outside the safe default and outside the current MVP commitment.

## TUI Boundary

The inventory-centric TUI presents core state through:

- Dashboard health summary.
- Skill inventory table with search, filters, and multi-selection.
- Detail panel for source, scope, targets, versions, findings, and ownership.
- Consolidated plan review.
- Progress, cancellation where safe, error, and rollback views.
- First-run guided discovery and import.

TUI widgets do not calculate effective state, decide ownership, run Git, or mutate paths. They issue typed requests and render core responses.

## Offline and Failure Behavior

- Local inventory and audit continue without network access.
- Existing locked Git content can synchronize if it exists locally.
- Missing remote content is a source-unavailable error, not a reason to install another revision.
- Outdated checks report unavailable rather than current when remotes cannot be reached.
- Cached recipe and provenance verification display freshness.
- Network failure cannot turn a safe removal into recursive cleanup.

## Security Boundaries

- Do not store Git credentials.
- Do not execute scripts contained in a skill as part of discovery, audit, or synchronization.
- Do not allow arbitrary commands in configurable adapters.
- Treat update diffs as changes to executable instructions and require review.
- Treat filesystem ownership as evidence-based state, not filename inference alone.
- Keep mutating paths constrained to resolved configuration, vault, backup, and verified target roots.

## Open Decisions

These decisions remain intentionally open:

- Manifest and lockfile schema details beyond the conceptual split.
- Exact headless `--json` output contract details.
- Concrete paths, formats, and verified behavior for each target adapter (resolved per adapter during its milestone).
- npm release automation details.

## Documentation and ADR Policy

Architecture changes update this document in the same change. ADRs under `docs/decisions/` are created only when a significant tradeoff needs durable historical context; they do not replace this document as the description of current architecture.
