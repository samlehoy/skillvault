# M0 Verified Facts

Facts observed on the reference machine (Windows 11 Pro 10.0.26200, 2026-07-26). Each fact lists its evidence class: **observed** (reproducible on this machine) or **pending** (needs official documentation or a live test before an adapter may rely on it).

## Junction spike — PASSED (observed)

Node's built-in `fs` junction support satisfies every MVP requirement without elevation. Spike (Node v25.6.1) verified 7/7:

1. Create junction via `fs.symlinkSync(target, link, 'junction')`.
2. Read content through the junction.
3. `fs.lstatSync(link).isSymbolicLink()` identifies the link without following it.
4. `fs.readlinkSync(link)` resolves the junction target.
5. `fs.rmdirSync(link)` removes the junction only.
6. Target content survives junction removal (the critical safety property).
7. Dangling junctions are detectable (`lstat` succeeds, `existsSync` is false).

Pending: re-run on Node 20 LTS in CI (spike ran on v25).

## Ink TUI spike — PENDING

Requires an interactive terminal session on Windows Terminal and ConHost. Not yet run.

## vercel-labs `skills` CLI layout (observed)

- Canonical store: `~/.agents/skills/` (~70 skills, plain directories, one per skill).
- Lockfile: `~/.agents/.skill-lock.json`, schema version 3. Per skill: `source` (owner/repo), `sourceType` (`github`), `sourceUrl`, `skillPath` (path to `SKILL.md` in repo), `skillFolderHash`, `installedAt`, `updatedAt`.
- Distribution to agents is per-target and inconsistent by design:
  - Claude Code: **junctions** from `~/.claude/skills/<id>` into the store.
  - OpenCode: **plain copies** into `~/.config/opencode/skills/` (subset: 9 of ~70).
  - Gemini/Antigravity: **plain copies** into `~/.gemini/skills/` and `~/.gemini/antigravity/skills/` (same 9-skill subset).

Import consequence: fixtures must cover both the junction layout and the copied-subset layout, and the same skill may appear in up to four places.

## Antigravity (observed, resolves the ADR-0005 risk clause)

- Antigravity does **not** read `~/.agents/` directly. The `~/.agents` store is only a source that the `skills` CLI copies out of.
- Two installed variants with **separate** skill directories — i.e., two distinct installations under the architecture's identity rule:
  - `~/.gemini/antigravity/skills/` (variant with user data at `%APPDATA%\Antigravity`).
  - `~/.gemini/antigravity-ide/skills/` (variant with user data at `%APPDATA%\Antigravity IDE`; contains the obra/superpowers skill set).
- Antigravity maintains its own lockfile at `~/.gemini/antigravity/skills-lock.json` (schema version 1; fields `source`, `sourceType`, `skillPath`, `computedHash` — structurally similar to the vercel-labs schema). This is additional Declared-provenance evidence for import.
- Skill format: directories containing `SKILL.md`, matching the canonical model.
- Pending: whether Antigravity's skill loader follows directory junctions (needs a live IDE test with a junction-linked skill); official documentation for these paths; project-scope skill location.

## OpenCode (observed)

- Global skills directory candidate: `~/.config/opencode/skills/` (plain directories containing `SKILL.md`).
- Config root `~/.config/opencode/` also holds `opencode.json`, `plugins/`, `AGENTS.md`, and a `package.json`/`node_modules` (plugin deps).
- Pending: official documentation confirmation, project-scope path, installation variants, junction consumption test.

## Claude Code (observed, evidence for M8)

- `~/.claude/skills/` entries are junctions into `~/.agents/skills` and are consumed correctly in daily use — junction consumption is already proven for this adapter.

## Unresolved before M2 can start

1. Ink spike on Windows Terminal + ConHost.
2. OpenCode official documentation citations (paths, project scope, variants).
3. Live junction-consumption test for OpenCode (link one disposable skill, confirm the IDE loads it).
