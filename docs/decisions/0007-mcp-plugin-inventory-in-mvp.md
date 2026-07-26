# ADR-0007: MCP and plugin support enters the MVP as read-only inventory

- Status: accepted
- Date: 2026-07-26

## Context

The owner proposed adding MCP server and IDE plugin management to SkillVault. The pain is real and observable on the reference machine: `mcp_config.json` files are duplicated across IDE configuration directories with no cross-IDE visibility. However, MCP servers are configuration entries that commonly contain secrets (observed: `mcp_oauth_tokens.json`), not content directories — the vault-and-junction model does not apply, and synchronizing secrets is a security design problem of its own. Plugins are executable artifacts with per-IDE installation mechanisms, which PRODUCT.md deliberately refuses to execute or manage.

Depth options considered: (a) read-only inventory + audit; (b) full MCP config synchronization; (c) full management of both domains. The release-delay and safety costs of (b) and (c) before any public release were raised explicitly.

## Decision

Option (a). The MVP gains **read-only visibility** for MCP servers and installed plugins:

- Per-IDE MCP server discovery with a presence matrix and same-name-different-config findings.
- Per-IDE installed-plugin inventory.
- Strictly read-only: no config writes, no installs/uninstalls, no execution.
- Secret values are never displayed, copied, or persisted; only the presence of named settings is shown.

Mutation remains skills-only in the MVP. Full MCP synchronization (secret-safe, environment-reference based) and plugin management are deferred-work candidates to be re-evaluated after the MVP ships.

## Consequences

- PRODUCT.md gains an "MCP and plugin visibility" MVP goal, a matching non-goal boundary, and acceptance criterion 13.
- The audit milestone (M6) absorbs the discovery/findings work; adapters must record MCP/plugin configuration locations as verified facts (M8 step 2).
- The TUI gains `[Skills] [MCP] [Plugins]` domain tabs; MCP/Plugins tabs have no action panel.
- Estimated release delay accepted by the owner: roughly two to three weeks versus skills-only.
