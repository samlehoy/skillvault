# ADR-0002: Implementation stack — TypeScript, Ink, npm distribution

- Status: accepted
- Date: 2026-07-26

## Context

Candidates were TypeScript + Ink, Go + Bubble Tea, and Rust + Ratatui. Deciding factors: the target audience installs agent skills via npm/npx today (verified on the reference machine), Windows directory junctions are a first-class Node `fs` API requiring no elevation, unsigned native `.exe` downloads trigger Windows SmartScreen friction for an indie open-source tool, and the author is most productive in TypeScript.

## Decision

- Language: TypeScript, compatible with Node LTS (>= 20); Bun allowed for local development, CI targets Node.
- TUI: Ink (React-based).
- Validation: Zod. Testing: Vitest.
- Git: shell out to the system `git` executable; credentials stay delegated to Git credential helpers / SSH agent.
- Distribution: npm package, `npx skillkeep`. License: MIT.

## Consequences

- Zero-friction install for the npm-native audience; no code signing needed for the MVP.
- Ink is weaker than native TUIs for very large tables; acceptable for skill inventories (hundreds, not millions of rows). Revisit only with measured evidence.
- A system `git` installation is a runtime prerequisite, verified by `doctor`.
