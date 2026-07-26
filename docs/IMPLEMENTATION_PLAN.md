# SkillVault MVP Implementation Plan

## Status

This is a living, milestone-level delivery plan. It deliberately avoids file-level tasks until verified adapter facts are recorded. Each milestone must leave a working, testable vertical slice; later milestones extend rather than replace earlier behavior.

The implementation stack is decided (see `ARCHITECTURE.md` and ADR-0002): TypeScript on Node LTS, Ink TUI, Vitest, Zod, Git via the system `git` executable, distributed as an npm package.

Progress: Milestone 0 and Milestone 1 are complete (M1 finished 2026-07-26: schemas, skill IDs and collisions, `SKILL.md` validation, override/disable resolution, source descriptors, ownership/actual/plan/operation models, cross-project fixtures, and determinism tests — 92 passing core tests). Milestone 2 is in progress (as of 2026-07-26): junction primitives, content hashing, verified backups, OpenCode read-only discovery (field-tested against a real installation), vault ingestion with immutable hash-keyed revisions, link/unlink planners, and the transaction executor with lock, staleness gate, and automatic rollback are done. Remaining in M2: headless `doctor`, the Ink TUI, the manual Windows acceptance run, and the first public 0.x release.

Recorded debts to clear inside M2/M7 (must not silently slip):

- A build/emit step (tsconfig is currently `noEmit`) and real package entry points are required before the first 0.x release; the published package still contains only the placeholder bin.
- Transaction records are returned in memory but not yet persisted under `~/.skillvault/`; user-requested rollback and crash recovery depend on persistence.
- The "mutations constrained to approved roots" security boundary is implicit in the planners; an explicit scoped-mutation guard must exist before uninstall work starts (M7).

## Goal

Deliver a Windows-first, inventory-centric TUI that reproducibly manages canonical AI agent skills across OpenCode, Antigravity, Claude Code, and Codex with explicit provenance, zero-drift auditing, and ownership-aware safe uninstall.

## Delivery Principles

- Build domain behavior in a reusable headless core.
- Test desired, resolved, and actual state independently of the TUI.
- Deliver thin vertical slices rather than completing every layer separately.
- Verify adapter behavior from official documentation or a real installation before coding it.
- Use test-driven development for state resolution, planning, audit, and filesystem behavior.
- Keep destructive behavior behind reviewed plans, backups, verification, and rollback.
- Keep Windows as the fully validated MVP platform while preserving portable filesystem and process boundaries.
- Develop in public: the repository is public from the start, and every milestone from M2 onward ships a public 0.x npm release.
- Update product and architecture docs in the same change when behavior or decisions change.

## Scope Dependencies

```text
M0 verified facts and spikes
  -> M1 core model
     -> M2 OpenCode local vertical slice
        -> M3 Antigravity adapter and contract validation
        -> M4 Git and reproducibility
           -> M5 discovery and import
              -> M6 provenance and audit
                 -> M7 safe update and uninstall
                    -> M8 remaining adapters
                       -> M9 hardening and MVP release
```

M3 (Antigravity) and M4 (Git) can be developed independently after the OpenCode slice, but both must converge before complete auditing and uninstall.

## Milestone 0: Verified Facts and Stack Spikes

### Outcome

Enough verified environment facts and de-risking spikes to write a file-level execution plan for the first vertical slice. The stack itself is already selected (ADR-0002); M0 validates it against Windows reality.

### Deliverables

- Verify OpenCode's actual global and project skill paths, skill format, installation variants, and documented removal behavior (`~/.config/opencode/skills` is the observed global candidate; confirm against documentation and a real installation).
- Verify how Antigravity discovers skills: no native skill directory is evident under `~/.antigravity`; determine whether it reads `~/.agents/` (the vercel-labs `skills` store), an extension mechanism, or another path — and whether it follows directory junctions.
- Document the vercel-labs `skills` CLI layout as an import source: `~/.agents/skills` store and `.skill-lock.json` schema (observed version 3).
- Record unsupported assumptions and version constraints.
- Record ADRs: project rename, implementation stack, adapter delivery order, deferred recipe subsystem, installer interop.
- Replace this milestone-level plan with or supplement it by file-level TDD execution plans per vertical slice.

### Verification

- A minimal Ink spike renders a table, detail panel, modal plan, progress event, and error state on Windows Terminal and ConHost.
- A minimal spike creates, inspects, and safely removes a test directory junction via Node `fs` inside a temporary directory, without elevation.
- OpenCode and Antigravity facts cite official documentation or reproducible observed behavior, including tested versions.

### Exit Criteria

- No unresolved blocker exists for TUI rendering, junction management, Git access, or automated tests on Windows.
- Architecture open decisions affected by the verified facts are updated.

## Milestone 1: Core State Model

### Outcome

The headless core can parse and validate canonical skills, manifests, lockfiles, scopes, sources, installations, and effective desired state without touching real agent IDE directories.

### Deliverables

- Versioned global/project manifest (`skills.yaml`) and lockfile (`skills.lock.json`) schemas as Zod models.
- Canonical skill ID normalization and collision reporting.
- Canonical `SKILL.md` validation.
- Global plus project override/disable resolution.
- Local and Git source descriptors without remote resolution yet.
- Typed desired, resolved, actual, finding, plan, operation, and ownership models.
- Fixtures covering multiple projects, installations, scope overrides, collisions, and invalid inputs.

### Verification

- Unit tests prove deterministic resolution regardless of manifest input ordering.
- Contract tests prove invalid and future schema versions fail without partial interpretation.
- Property or table-driven tests cover ID normalization and project precedence.
- No core test requires an interactive terminal.

### Exit Criteria

- The same valid inputs always produce the same effective skill IDs, source intents, and target intents.
- Domain errors are structured and renderable by both TUI and headless consumers.

## Milestone 2: OpenCode Local Vertical Slice

### Outcome

The TUI manages one local canonical skill across verified OpenCode global and project targets using safe directory junctions. First public 0.x npm release.

### Deliverables

- Reusable filesystem abstraction for canonical paths, junction inspection, staging, backups, and scoped mutation.
- OpenCode reference adapter using only verified paths and behavior.
- Read-only installation and existing-skill discovery.
- Vault ingestion for a local skill into `~/.skillvault/vault/`.
- Plan generation for adding, linking, unlinking, and restoring one skill.
- Transaction lock, operation record, post-condition verification, and rollback.
- Inventory-centric TUI with dashboard, table, detail panel, plan review, progress, and result views.
- Minimal headless `doctor` operation for filesystem and adapter diagnostics.

### Verification

- Integration tests use temporary directories and junctions rather than the developer's real configuration.
- Failure-injection tests interrupt each transaction phase and confirm restoration or an explicit non-rollbackable diagnostic.
- A manual Windows acceptance run links a disposable local skill into a disposable verified OpenCode target and returns to its original state.
- TUI tests prove that cancelling plan review performs no mutation.

### Exit Criteria

- Desired, resolved, and actual state agree after apply.
- Replacing unmanaged content requires backup and explicit confirmation.
- The TUI contains no direct filesystem mutation logic.

## Milestone 3: Antigravity Adapter and Contract Validation

### Outcome

Antigravity reaches parity with the OpenCode slice, and the adapter contract is proven against two structurally different IDEs (a terminal tool and a VS Code-derived editor) before the rest of the core hardens around it.

### Deliverables

- Antigravity adapter built only on the discovery facts verified in M0.
- Shared adapter contract test suite covering discovery, identity, linking, drift, ownership, plan, rollback, and offline behavior, run against both adapters.
- Cross-IDE synchronization of one canonical skill to OpenCode and Antigravity from a single vault entry.
- Recorded tested versions, paths, formats, installation variants, and evidence for Antigravity.
- Contract adjustments discovered during the second implementation, applied while the surface area is still small.

### Verification

- Both adapters pass the identical contract suite.
- Shared-target detection proves multiple frontends using one canonical path appear as one installation; separate paths remain distinct installations.
- A disposable end-to-end Windows acceptance run manages one skill across both IDEs and returns to the original state.

### Exit Criteria

- One vault entry synchronizes to both daily-driver IDEs on a real machine.
- No adapter-specific special case leaks into core planning or transaction logic.

## Milestone 4: Git Sources and Reproducibility

### Outcome

A Git-hosted skill at a repository root or explicit subdirectory resolves to a locked commit and reproduces without following a moving branch.

### Deliverables

- Git repository cache (`~/.skillvault/cache/git/`) and source resolver shelling out to system `git`.
- Commit SHA and normalized content hash lock entries.
- Explicit repository subdirectory support.
- Authentication delegated to the system Git configuration and SSH agent.
- Remote update check that does not mutate the lockfile.
- Reviewed update plan showing old/new commit and changed files.
- Offline behavior for cached locked content and unavailable remotes.
- Project manifest and lockfile workflow suitable for source control.

### Verification

- Integration tests use local temporary Git repositories, branches, commits, and subdirectories.
- Tests prove a branch moving after lock creation does not alter synchronization output.
- Tests prove unavailable remotes do not report a skill as current.
- Tests prove no credentials are persisted by SkillVault.
- A fresh temporary environment reproduces identical canonical content from the same manifest, lockfile, and accessible repository.

### Exit Criteria

- Git synchronization installs exactly the locked revision.
- Updating a lock requires a reviewed mutating plan.
- Offline cached synchronization is explicit and deterministic.

## Milestone 5: Guided Discovery and Import

### Outcome

First run discovers existing skills across supported adapters, classifies duplicates/conflicts, and offers a safe import plan without automatic takeover — including skills installed by third-party installers.

### Deliverables

- First-run discovery flow.
- Existing skill fingerprinting and exact duplicate grouping.
- Deterministic collision and likely-duplicate candidate reporting.
- Import candidate model with scope, target, content, path, and ownership evidence.
- Third-party installer layout support: the vercel-labs `skills` store (`~/.agents/skills` plus `.skill-lock.json`) is discovered as unmanaged skills with importable lock metadata.
- Conflict resolution for same normalized ID with different content.
- Import plan that stages canonical content, backs up unmanaged directories, and replaces approved targets with managed links.
- Recovery view for interrupted imports.

### Verification

- Fixture matrix covers identical copies, renamed copies, same-name divergent content, broken links, inaccessible paths, and installer-managed junction layouts (for example, agent skill directories that are junctions into `~/.agents/skills`).
- Tests prove discovery and plan preview are read-only.
- Tests prove unresolved divergent-content conflicts block apply.
- Failure-injection tests prove original unmanaged skills can be restored.

### Exit Criteria

- A user with an existing multi-IDE setup — including one built with `npx skills` — can reach a managed zero-drift state without losing unapproved content.
- Every imported path has recorded ownership evidence and an undo path.

## Milestone 6: Provenance and Audit

### Outcome

The inventory explains where each skill came from, how confident that attribution is, and why its current state is healthy or actionable.

### Deliverables

- Provenance evidence and confidence model: Verified, Declared, Inferred, Unknown, and User-verified.
- Installer lockfile evidence: metadata imported from `.skill-lock.json` enters as Declared and can upgrade to Verified after re-verification against the declared repository.
- Source repository, subdirectory, ref, commit, verification result, and freshness display.
- Editable provenance with project-manifest persistence where appropriate.
- Audits for outdated revisions, manifest-lock mismatch, duplicates, unused entries, scope conflicts, broken links, drift, and stale/unknown provenance.
- Stable finding identifiers, severity, evidence, and remediation intent.
- Inventory filters and batch selection based on health, scope, target, and source status.
- Read-only minimal headless `audit` operation with `--json` output.

### Verification

- Tests prove name-only repository similarity never becomes Verified provenance.
- Tests prove user corrections are distinguishable from independently verified sources.
- Tests prove installer-declared metadata is labelled Declared until independently re-verified.
- Golden or snapshot tests cover human-readable TUI findings without making rendered strings the domain contract.
- Offline tests retain confidence while marking remote verification unavailable or stale.
- Audit has no mutation side effects.

### Exit Criteria

- Every source link shown in the TUI has a visible confidence and freshness state.
- Every required MVP audit category has deterministic fixtures and passing tests.

## Milestone 7: Safe Batch Update and Uninstall

### Outcome

Users can review and apply batch updates and ownership-aware uninstall plans without treating “clean” as blind recursive deletion. The official recipe subsystem is deferred; uninstall is ownership-based managed removal.

### Deliverables

- Multi-select batch plan composition.
- Scope removal, selected-target removal, and vault deletion as separate intents.
- Reference checks that block vault deletion while still used.
- Default flow: SkillVault-owned cleanup, residual scan, optional reviewed safe clean.
- Ownership classes for SkillVault-owned, user-owned, and unknown paths.
- Backups and transaction rollback across batch operations.
- Minimal headless `sync` operation with explicit non-interactive approval semantics (`--yes`).

### Verification

- Tests prove unknown files survive default uninstall and safe clean.
- Tests prove removal from one scope leaves other references and vault content intact.
- Tests prove residual scans do not mutate state.
- Batch failure-injection tests prove completed operations roll back where declared reversible.
- Security tests constrain mutations to approved vault, backup, configuration, and verified target roots.

### Exit Criteria

- No default uninstall path recursively removes content based only on naming or location guesses.
- Plans identify every affected path, ownership class, backup, and rollback limitation.

## Milestone 8: Remaining Built-in Adapters

### Outcome

Claude Code and Codex reach the same supported behavior as the OpenCode and Antigravity adapters, and a declarative custom adapter covers unlisted tools.

### Delivery Order

For each adapter independently:

1. Verify official documentation and observed installation behavior.
2. Record tested versions, paths, formats, installation variants, and uninstall evidence.
3. Implement discovery and actual-state inspection.
4. Pass the shared adapter contract suite.
5. Add synchronization and managed uninstall.
6. Complete a disposable end-to-end Windows acceptance run.

### Deliverables

- Claude Code built-in adapter (`~/.claude/skills` and `.claude/skills` are the observed candidates; junction consumption is already demonstrated on the reference machine).
- Codex built-in adapter.
- Declarative custom adapter for explicit paths and standard managed-link behavior, without arbitrary hooks.
- Adapter health shown in the TUI.

### Verification

- Every built-in adapter passes the same contract suite as OpenCode and Antigravity.
- No adapter claims a path that lacks recorded evidence.

### Exit Criteria

- All four target agent IDEs meet the product acceptance criteria on their verified Windows configurations.
- Unsupported versions fail safely with actionable diagnostics.

## Milestone 9: MVP Hardening and Release

### Outcome

The complete Windows-first MVP is recoverable, diagnosable, documented, and distributable as a stable npm release.

### Deliverables

- Minimal headless `scan`, `audit`, `sync`, and `doctor` operations finalized from demonstrated recovery needs.
- Stable local data migration policy for schema changes.
- Concurrency, cancellation, crash recovery, and stale-lock handling.
- Large-inventory performance tests and responsive progress reporting.
- Keyboard help, first-run guidance, accessibility review, and terminal compatibility matrix.
- npm packaging polish: `npx @samlehoy/skillvault` first-run experience, integrity verification, and clean self-removal.
- User guide for import, project sharing, provenance correction, updates, uninstall, rollback, offline use, and recovery.
- Release checklist tied to every acceptance criterion in `PRODUCT.md`.

### Verification

- End-to-end test starts from representative unmanaged installations (including a `npx skills`-built setup), imports them, synchronizes all supported targets, audits zero drift, updates a Git skill, uninstalls selected targets, and rolls back a transaction.
- A clean machine reproduces a committed sample project's locked skill set via `npx @samlehoy/skillvault`.
- Crash-recovery tests terminate the process during mutating phases and validate the next-run recovery experience.
- Performance targets are defined from measured representative inventories rather than guessed upfront.
- Documentation steps are exercised on a clean Windows environment.

### Exit Criteria

- All MVP acceptance criteria pass with recorded evidence.
- No critical or high-severity data-loss issue remains open.
- Product, architecture, implementation, and user documentation describe the shipped behavior.

## Deferred Work

After MVP evidence justifies expansion, independently plan:

- Official adapter uninstall recipe subsystem with source, compatibility, and freshness metadata.
- Production macOS and Linux support.
- Full CLI parity or a standalone automation API.
- Desktop or browser UI.
- Background monitoring.
- Hosted registries, accounts, and cloud synchronization.
- npm registry as a skill source type.
- Richer supply-chain analysis.
- Semantic duplicate assistance.
- Dependency resolution.
- Sandboxed third-party adapter extensions.

None of these should enter an MVP milestone without an explicit product scope change.

## Documentation Maintenance

- Product behavior or scope changes update `docs/PRODUCT.md`.
- Current structural decisions update `docs/ARCHITECTURE.md`.
- Delivery sequencing and milestone status update this document.
- Significant historical tradeoffs receive an ADR under `docs/decisions/`.
- Adapter facts include their evidence and verification date in the implementation artifacts produced during each adapter's milestone.
