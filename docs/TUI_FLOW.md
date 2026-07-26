# SkillVault TUI — User Flow

## Status

Living design document for the TUI's screens, navigation, and keybindings. Decided in the 2026-07-26 UX grilling session; supersedes the first-iteration occurrence-list UI. Implementation follows this document; deviations must update it in the same change.

## Design Decisions (summary)

1. **Skill-first, not location-first.** The main list shows unique canonical skills (deduplicated by ID), not one row per physical path. A presence matrix shows where each skill lives. Rationale: the product promise is "one skill, many IDEs, zero drift" — that is only visible when one row aggregates all locations.
2. **Enter opens an action panel** — mutations across multiple locations are always an explicit, per-target choice, never a side effect of one keypress.
3. Filters are **non-hierarchical** (they narrow the same list); there is no drill-down mode.
4. Aggregate row status = the most attention-worthy of its locations: `broken` > `unmanaged` > `external` > `managed`.
5. Esc always goes back one level; `q` quits only from the main screen.
6. Same-ID-different-content copies **block** management until the user picks a canonical source (required by PRODUCT.md).
7. **(2026-07-26 revision, owner feedback)** Categorization must sit inside the eye's scanning path, not beside it: the passive four-line legend and corner filter chips went unnoticed. The list is now **grouped under colored status section headers** (`○ UNMANAGED (84) — not yet managed…`) with the meaning inline; the target filter is a **full-width tab bar with counts** directly above the table, switchable with `←`/`→` as well as `a`/`1`–`5`; rows show `N IDE · M copies` instead of the cryptic `oc✓ av–` matrix codes (per-location detail stays in the detail panel); status meanings also appear in the `?` help overlay.

## Screen Map

```text
                    ┌────────────────────┐
                    │  1. INVENTORY      │◄──────────────┐
                    │  (main screen)     │               │
                    └─┬────┬────┬────┬───┘               │
              Enter   │    │/   │?   │q                  │
            ┌─────────┘    │    │    └─► exit            │
            ▼              ▼    ▼                        │
   ┌──────────────┐   (inline (help                      │
   │ 2. ACTION    │   search) overlay)                   │
   │    PANEL     │                                      │
   └─┬──────────┬─┘                                      │
     │m         │Esc ────────────────────────────────────┤
     ▼          │                                        │
  ┌────────────────┐   conflict? ┌─────────────────┐     │
  │ 3. PLAN REVIEW │◄────────────│ 2b. PICK SOURCE │     │
  └─┬──────────┬───┘             └─────────────────┘     │
    │y         │n/Esc ───────────────────────────────────┤
    ▼                                                    │
  ┌────────────────┐  any key                            │
  │ 4. RESULT      │─────────────────────────────────────┘
  └────────────────┘
```

## 1. Inventory (main screen)

```text
 ⬢ SkillVault · 74 skills          [a All] [1 opencode] [2 claude] [3 agents]
──────────────────────────────────────────────────────────────────────────────
 ●   0 managed    linked into the SkillVault vault
 ◆  22 external   link owned by another tool (e.g. npx skills)
 ✖   0 broken     link whose target no longer exists
 ○  52 unmanaged  plain folder, not yet managed — press Enter to manage
──────────────────────────────────────────────────────────────────────────────
❯ ○ wrangler                      oc✓ cl– ag✓    2 copies
  ○ web-perf                      oc✓ cl– ag✓    2 copies
  ◆ code-review                   oc– cl✓ ag✓    2 copies
  ○ durable-objects               oc✓ cl– ag✓    2 copies
    ↓ 70 more
──────────────────────────────────────────────────────────────────────────────
 wrangler — found in 2 locations:
   opencode  ~/.config/opencode/skills/wrangler   (copy)
   agents    ~/.agents/skills/wrangler            (store)
──────────────────────────────────────────────────────────────────────────────
 ↑↓ select · Enter manage · / search · a,1-3 filter · ? help · q quit
```

Elements, top to bottom:

- **Header:** app name + unique-skill count. Filter tabs on the right; the active tab is highlighted.
- **Legend:** all four statuses, always visible, with live counts and one-line meanings. Zero-count rows render dimmed.
- **Table (12-row viewport):** aggregate status symbol, skill ID, presence matrix (one column per target detected on this machine: `oc` OpenCode, `cl` Claude Code, `ag` agents store, `av` Antigravity once supported; `✓` present, `–` absent), and a copy-count note when a skill exists in more than one location. `↑/↓ N more` indicators when the list overflows.
- **Detail panel:** every physical location of the selected skill with its kind (copy / junction / store) — the deduplication is transparent, never hidden.
- **Key bar.**

Sort order: most attention-worthy status first (`broken`, `unmanaged`, `external`, `managed`), then alphabetical. Deterministic.

### Search (`/`)

Inline input in the key-bar row. Typing narrows the table incrementally (substring match on ID). `Esc` clears and closes; `Enter` keeps the filter and returns focus to the table. Search composes with the active target filter.

### Filters (`a`, `1`–`n`)

Number keys map to the targets detected on this machine, in header order. A filter narrows the table to skills present at that target; the presence matrix and copy counts still show the full picture per row. `a` returns to All. Filtering never changes the screen — no drill-down.

### Notices above the table

- **Recovery banner** (red): shown when the persistent transaction journal (`~/.skillvault/state/transactions/`) holds `in-progress` (crashed) or `rollback-failed` entries — backups are preserved and `skillvault doctor` lists per-plan detail.
- **First-run hint** (dim): shown while no discovered skill is managed yet, pointing at Enter-to-manage and `g` grouping.

### Empty state

```text
 No skills found.

 SkillVault looked in the OpenCode, Claude Code, and agents-store
 directories. Run `skillvault doctor` for a diagnosis.
```

## 2. Action panel (Enter)

One screen per skill. Lists every location it exists in **and** every supported target it could be linked into.

```text
 wrangler   ○ unmanaged · 2 copies · content identical
──────────────────────────────────────────────────────────────────────────────
 Manage in which targets?

 [x] opencode     ~/.config/opencode/skills/wrangler    copy → junction
 [x] agents       ~/.agents/skills/wrangler             store → junction
 [ ] claude-code  (not installed here — link will be created)
──────────────────────────────────────────────────────────────────────────────
 space toggle · m build plan · Esc back
```

Rules:

- Checked by default: every location where the skill already exists.
- Unchecked entries are additive: a junction will be created where nothing exists yet.
- `m` builds one consolidated plan covering every checked target and goes to Plan review.
- Esc returns to Inventory with nothing changed.

### 2b. Pick canonical source (conflict gate)

Shown **instead of** the checkbox list when copies differ in content (PRODUCT.md: same-ID-different-content blocks until resolved):

```text
 wrangler   ⚠ 2 copies with DIFFERENT content — pick the canonical one
──────────────────────────────────────────────────────────────────────────────
 ❯ opencode   ~/.config/opencode/skills/wrangler    sha256:45cc19…  2026-06-11
   agents     ~/.agents/skills/wrangler             sha256:9f86d0…  2026-05-13
──────────────────────────────────────────────────────────────────────────────
 The chosen copy becomes the vault content; the others are backed up
 and replaced by junctions when you apply the plan.

 ↑↓ select · Enter choose · Esc back
```

After choosing, the normal action panel appears with the choice pinned. SkillVault never merges automatically.

## 3. Plan review

Unchanged from the current implementation, now potentially multi-location:

```text
 ⬢ SkillVault
──────────────────────────────────────────────────────────────────────────────
 Plan review  plan-3f9c21ab90ddc41e6a1c…
 ╭──────────────────────────────────────────────────────────────────────────╮
 │ backup        ~/.config/opencode/skills/wrangler → bak-2d7f3df86e84c953  │
 │ link-create   ~/.config/opencode/skills/wrangler → …vault/wrangler/ca92… │
 │ backup        ~/.agents/skills/wrangler → bak-77aa01c3b2d94e10           │
 │ link-create   ~/.agents/skills/wrangler → …vault/wrangler/ca9285…        │
 ╰──────────────────────────────────────────────────────────────────────────╯
 ⚠ backs up first: 2 paths
──────────────────────────────────────────────────────────────────────────────
 y apply · n cancel — no changes
```

Invariants (already enforced and tested): cancel performs zero mutation; apply goes through the transaction executor (lock, staleness gate, verify, auto-rollback).

## 4. Result

```text
 ✔ Success                        │    ✖ Failed
 Applied 4 operation(s).          │    Operation "link-create" failed: …
                                  │    All applied operations were rolled back.
 any key → back to inventory
```

Any key returns to Inventory, which reloads so statuses reflect reality.

## Help overlay (`?`)

Dim full-screen overlay listing every key, grouped by screen. Any key closes it.

## Keybinding reference

| Key         | Where       | Action                                          |
| ----------- | ----------- | ----------------------------------------------- |
| `↑` `↓`     | Inventory   | Move selection                                  |
| `Enter`     | Inventory   | Open action panel for the selected skill        |
| `/`         | Inventory   | Incremental search; Esc clears                  |
| `a`, `1`–`n`| Inventory   | Target filter tabs                              |
| `g`         | Inventory   | Toggle grouping: by status ↔ by bundle          |
| `?`         | Inventory   | Help overlay                                    |
| `q`         | Inventory   | Quit (main screen only)                         |
| `space`     | Action panel| Toggle target checkbox                          |
| `m`         | Action panel| Build consolidated plan → Plan review           |
| `↑↓`+`Enter`| Pick source | Choose the canonical copy                       |
| `y`         | Plan review | Apply the plan                                  |
| `n` / `Esc` | Plan review | Cancel — provably no mutation                   |
| `Esc`       | Everywhere  | Back one level (never quits from a sub-screen)  |

## Edge cases

- **Skill present everywhere and already managed:** action panel still opens; building a plan yields "No operations — already in the desired state" (no-op plan).
- **Broken junction:** the action panel offers relink (target checked, plan = `link-remove` + `link-create`) using the vault revision recorded for that skill; if the vault revision is also gone, the row is actionable only through a future repair flow — MVP shows an explanatory notice.
- **External link (e.g. `npx skills` junction):** checking that target means "take over": the plan replaces the foreign junction with a SkillVault junction (`link-remove` + `link-create`; the foreign store content is never touched).
- **Plan goes stale between review and apply** (files changed underneath): the executor rejects it; Result shows "re-plan needed" and returns to a refreshed Inventory.
- **Terminal too short for legend + 12 rows:** viewport shrinks before the legend collapses to one summary line.

## Bundle grouping (decided 2026-07-26, implemented 2026-07-27)

A **bundle** is a source repository that ships multiple skills (e.g. `obra/superpowers`, `cloudflare/skills`). It is not a plugin (plugins are executable IDE extensions, ADR-0007). Decisions, now implemented:

- The unit of management and removal stays the **individual skill**; removing one skill never implicitly removes its bundle (no dependency resolver — PRODUCT.md non-goal).
- `g` toggles the section grouping: by status (default) ↔ by bundle (`▣ obra/superpowers (14)`, `▣ (unknown source)` last); the provider dimension is already covered by the target tab bar, so no drill-down screens are added. Within a bundle section rows keep the severity-then-alphabetical order.
- The detail panel and action panel show bundle membership (`▣ part of obra/superpowers — 14 skills`). The action panel's explicit "apply to all N skills from this bundle" batch option ships with the batch mechanics in M7; until then the panel states that honestly, with the standing warning that same-bundle skills may reference each other.
- Bundle labels come from installer lockfiles (`~/.agents/.skill-lock.json` v3, Antigravity `skills-lock.json` v1) as **Declared** provenance evidence, re-read on every inventory load; that provenance-reading slice was pulled forward from M6 into M5. No evidence → `(unknown source)`, never a name-based guess.

## Planned extension: MCP and Plugins tabs (read-only)

Per ADR-0007, the header gains domain tabs — `[Skills] [MCP] [Plugins]` — where MCP and Plugins are read-only inventories: presence matrix per IDE, same-name-different-config findings for MCP servers, and an installed-plugin list. No action panel exists in those tabs (nothing is mutable), and secret values are never displayed. Detailed screen designs extend this document when that milestone (M6) starts.

## Out of scope for this iteration

Unlink/uninstall flows, batch multi-select across skills, provenance display and editing, audit findings views, and the MCP/Plugins tab designs — they arrive with their milestones (M5–M7) and must extend this document when they do.
