# ADR-0005: Interop with third-party skill installers (vercel-labs `skills`)

- Status: accepted
- Date: 2026-07-26

## Context

The vercel-labs `skills` CLI (`npx skills`) is the de facto installer in the target audience. Observed on the reference machine: a canonical store at `~/.agents/skills` (~70 skills), a `.skill-lock.json` (schema version 3) recording source repository, in-repo path, folder hash, and timestamps, junction links into `~/.claude/skills`, and plain copies (a drifting subset) in `~/.config/opencode/skills`. It already implements a store + lockfile + links — the naive "installers are just copy-and-forget" framing is false.

Options considered: (a) ignore its structure and import from zero; (b) adopt its store and lockfile as SkillKeep's own; (c) keep SkillKeep's own vault but consume the installer lockfile as provenance evidence at import.

## Decision

Option (c). SkillKeep maintains its own vault (`~/.skillkeep/vault/`). During import, `.skill-lock.json` metadata is mapped into the provenance model as **Declared** evidence, upgradeable to **Verified** after re-verification against the declared repository. The npm registry is not a source type in the MVP.

## Consequences

- Importing an existing `npx skills` setup yields immediate provenance for every skill instead of starting from Unknown.
- SkillKeep does not read or write `~/.agents` after import; two tools writing one store cannot coexist with transactional guarantees. Post-import, SkillKeep expects to be the single manager.
- Risk flagged in M0: if Antigravity turns out to read `~/.agents/skills` directly, that store becomes a sync *target*, and this decision must be revisited.

## Resolution of the flagged risk (2026-07-26)

M0 verification (see `docs/adapters/M0_VERIFIED_FACTS.md`) showed Antigravity does **not** read `~/.agents/` directly: each variant has its own skills directory under `~/.gemini/`, and the `skills` CLI merely copies into them. The decision stands unchanged. Bonus finding: Antigravity keeps its own `skills-lock.json` (schema v1), which becomes a second Declared-provenance source at import time.
