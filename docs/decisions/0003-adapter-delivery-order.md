# ADR-0003: Adapter delivery order — OpenCode, then Antigravity, then the rest

- Status: accepted
- Date: 2026-07-26

## Context

The author's daily-driver IDEs are OpenCode and Antigravity; Claude Code and Codex are used occasionally. Until external users arrive, dogfooding is the only feedback loop. The original plan delivered all non-reference adapters at the end, meaning the adapter contract would ossify around a single IDE and the product's core promise (cross-IDE sync) would be unusable by its own author for most of development.

## Decision

1. OpenCode remains the reference adapter (M2).
2. Antigravity is the second adapter, delivered immediately after the first vertical slice (M3), validating the adapter contract against a structurally different IDE while the surface area is small.
3. Claude Code and Codex remain in the MVP but arrive late (M8), after the core feature set is complete.

## Consequences

- Cross-IDE sync is dogfooded from M3 onward.
- Antigravity's skill discovery mechanism is unverified and must be established in M0; it is a known risk that it may not use a native skills directory.
- Claude Code is expected to be low-cost at M8: its skill layout matches the canonical `SKILL.md` directory format and junction consumption is already demonstrated on the reference machine.
