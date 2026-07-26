# ADR-0004: Defer the official uninstall recipe subsystem beyond the MVP

- Status: accepted
- Date: 2026-07-26

## Context

The original MVP included a verified official uninstall recipe model per adapter: source documentation URL, compatible version range, freshness metadata, applicability checks, and fallback logic. This is the heaviest trust subsystem in the design, built for a user base that does not exist yet, and the architecture already defines an ownership-based managed removal as the fallback.

## Decision

The recipe subsystem is deferred until after the MVP. MVP uninstall is ownership-based managed removal only: remove SkillKeep-owned artifacts, scan residuals, offer a reviewed clean of verified residuals, and always preserve unknown files. The "Officially owned" ownership class is reserved but unused in the MVP.

## Consequences

- MVP acceptance criterion 9 in `PRODUCT.md` was reworded accordingly.
- Safety invariants are unchanged: no default path recursively deletes based on naming or location guesses.
- When the subsystem is introduced later, it slots into the existing uninstall flow ahead of managed removal.
