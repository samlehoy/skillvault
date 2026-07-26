# SkillKeep

SkillKeep is a local-first TUI for managing AI agent skills across agent IDEs. It keeps a canonical skill vault, resolves global and project-specific configuration, and helps users discover, audit, synchronize, update, and safely uninstall skills.

SkillKeep is not another skill installer. Installers already exist; SkillKeep adds committed per-project manifests and lockfiles that reproduce the same skill set on another machine, drift auditing, ownership-aware safe uninstall, and explicit source provenance — managed from one inventory-centric terminal UI.

The project is currently in pre-development. Its MVP is Windows-first, distributed via npm (`npx skillkeep`), and targets OpenCode, Antigravity, Claude Code, and Codex through phased adapter delivery.

## Core Goals

- Keep one source of truth for skills used by multiple agent IDEs.
- Reproduce the same effective skill set from committed manifests and lockfiles.
- Detect outdated, duplicate, unused, conflicting, and drifted skills.
- Preserve verifiable source provenance, including repository links when known.
- Make filesystem changes reviewable, reversible, and ownership-aware.

## Documentation

- [Product scope and goals](docs/PRODUCT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Decision records](docs/decisions/)

These documents are living sources of truth. Changes to product behavior, scope, or architecture must update the relevant documentation in the same change.

## License

MIT.
