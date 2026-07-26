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

## Ink TUI spike — PASSED headless, interactive check pending

Headless spike (Node v25.6.1, `ink` + `ink-testing-library`) verified 7/7: inventory table rendering, bordered plan box, progress updates across rerenders, error state, and a real `render()`/`unmount()` cycle against a non-TTY stdout (CI-like environment) without crashing.

Pending: an interactive run on Windows Terminal and ConHost (keyboard input, raw mode, resize) — requires a live terminal session.

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

## OpenCode (observed + official source citations)

Confirmed from upstream source (`anomalyco/opencode`, retrieved 2026-07-26 via documentation index):

- Skill discovery patterns: `{skill,skills}/**/SKILL.md` under OpenCode directories — i.e. global `~/.config/opencode/skill{,s}/` and project `.opencode/skill{,s}/` (`packages/opencode/src/skill/index.ts`).
- Global config root is XDG-based: `~/.config/opencode/` (`packages/core/src/global.ts`).
- **OpenCode also natively discovers external skills from `.claude/skills/` and `.agents/skills/`** (same source file, `CLAUDE_EXTERNAL_DIR` / `AGENTS_EXTERNAL_DIR` with pattern `skills/**/SKILL.md`).
- Skill discovery globs run with `symlink: true` (`packages/core/src/skill.ts`) — skills behind linked directories are followed by design. Strong evidence junctions are consumed; final confirmation folds into the M2 live acceptance run.
- Upcoming: the v2 config spec redesigns `skills` into a single array of local-path/remote-URL discovery sources (`specs/v2/config.md`). The adapter must record which config schema a detected installation uses.

Planning consequence of the external-directory fact: on this machine OpenCode can see the same skill up to three times (`~/.config/opencode/skills` copy, `~/.claude/skills` junction, `~/.agents/skills` store entry). The OpenCode adapter must treat the external directories as part of actual-state inspection, and the import flow must warn that leaving the `~/.agents` store in place keeps those skills visible to OpenCode alongside SkillVault-managed ones — a duplicate-visibility audit finding, not a silent assumption.

- Observed locally: `~/.config/opencode/skills/` holds plain copies (9-skill subset installed by the `skills` CLI); config root also holds `opencode.json`, `plugins/`, `AGENTS.md`, and plugin `node_modules`.
- Pending: installation variants inventory (CLI/desktop), tested-version recording against a live installation.

## Claude Code (observed, evidence for M8)

- `~/.claude/skills/` entries are junctions into `~/.agents/skills` and are consumed correctly in daily use — junction consumption is already proven for this adapter.

## Unresolved before M2 can start

1. Interactive Ink check on Windows Terminal + ConHost (keyboard input, raw mode, resize) — headless rendering already proven.
2. OpenCode installation-variant inventory and tested-version recording against a live installation.
3. Live junction-consumption test for OpenCode (link one disposable skill, confirm the IDE loads it) — low risk given the `symlink: true` citation; folds into the M2 acceptance run.
