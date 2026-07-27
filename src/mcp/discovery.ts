import fs from "node:fs";
import path from "node:path";

/**
 * Read-only MCP server and plugin inventory (ADR-0007, M6). Config layouts
 * verified on the reference machine 2026-07-27:
 *
 * - OpenCode `~/.config/opencode/opencode.json`: `mcp` object
 *   (`{type, command, enabled}` per server) and a `plugin` array; loose
 *   plugin files live in `~/.config/opencode/plugins/`.
 * - Antigravity `~/.gemini/antigravity{,-ide}/mcp_config.json`:
 *   `mcpServers` object — stdio form `{command, args, env}` or remote form
 *   `{serverUrl, headers}`.
 * - Claude Code `~/.claude.json`: `mcpServers` object (`{type, url,
 *   headers}` observed).
 *
 * Secret safety is absolute: env-var and header **values** are never read
 * into the view model — only their key names — and URL query strings are
 * stripped because they can embed credentials. Discovery never writes.
 */

export interface McpServerView {
  readonly name: string;
  readonly ide: "opencode" | "antigravity" | "antigravity-ide" | "claude-code";
  readonly transport: "stdio" | "remote" | "unknown";
  /** Command line (stdio) or URL without its query string (remote). */
  readonly target: string;
  readonly enabled?: boolean;
  /** Names of env/header keys; the values never leave the config file. */
  readonly secretKeys: readonly string[];
  readonly configPath: string;
}

export interface McpInventory {
  readonly servers: readonly McpServerView[];
  /** Same server name configured differently across IDEs. */
  readonly findings: readonly string[];
  readonly warnings: readonly string[];
}

export interface PluginView {
  readonly ide: "opencode";
  readonly name: string;
  readonly detail: string;
}

export interface PluginInventory {
  readonly plugins: readonly PluginView[];
  readonly warnings: readonly string[];
}

export interface McpEnvironment {
  readonly homeDir: string;
}

const stripQuery = (url: string): string => url.split("?")[0] ?? url;

const asCommandString = (command: unknown, args: unknown): string => {
  const parts: string[] = [];
  if (typeof command === "string") parts.push(command);
  else if (Array.isArray(command)) {
    parts.push(...command.filter((c): c is string => typeof c === "string"));
  }
  if (Array.isArray(args)) {
    parts.push(...args.filter((a): a is string => typeof a === "string"));
  }
  return parts.join(" ");
};

const secretKeyNames = (value: unknown): string[] =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).sort()
    : [];

function readJson(filePath: string): { data?: unknown; warning?: string } {
  if (!fs.existsSync(filePath)) return {};
  try {
    return { data: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch {
    return { warning: `${filePath} is not readable JSON; skipped.` };
  }
}

function serversFromEntries(
  entries: unknown,
  ide: McpServerView["ide"],
  configPath: string,
): McpServerView[] {
  if (typeof entries !== "object" || entries === null || Array.isArray(entries)) {
    return [];
  }
  const servers: McpServerView[] = [];
  for (const [name, raw] of Object.entries(entries as Record<string, unknown>).sort(
    ([a], [b]) => a.localeCompare(b),
  )) {
    if (typeof raw !== "object" || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const url =
      typeof entry["serverUrl"] === "string"
        ? entry["serverUrl"]
        : typeof entry["url"] === "string"
          ? entry["url"]
          : undefined;
    const command = asCommandString(entry["command"], entry["args"]);
    const transport: McpServerView["transport"] =
      url !== undefined ? "remote" : command !== "" ? "stdio" : "unknown";
    servers.push({
      name,
      ide,
      transport,
      target: url !== undefined ? stripQuery(url) : command,
      ...(typeof entry["enabled"] === "boolean"
        ? { enabled: entry["enabled"] }
        : {}),
      secretKeys: [
        ...secretKeyNames(entry["env"]),
        ...secretKeyNames(entry["headers"]),
      ],
      configPath,
    });
  }
  return servers;
}

export function discoverMcpServers(env: McpEnvironment): McpInventory {
  const servers: McpServerView[] = [];
  const warnings: string[] = [];

  const sources: readonly {
    readonly filePath: string;
    readonly ide: McpServerView["ide"];
    readonly key: "mcp" | "mcpServers";
  }[] = [
    {
      filePath: path.join(env.homeDir, ".config", "opencode", "opencode.json"),
      ide: "opencode",
      key: "mcp",
    },
    {
      filePath: path.join(env.homeDir, ".gemini", "antigravity", "mcp_config.json"),
      ide: "antigravity",
      key: "mcpServers",
    },
    {
      filePath: path.join(
        env.homeDir,
        ".gemini",
        "antigravity-ide",
        "mcp_config.json",
      ),
      ide: "antigravity-ide",
      key: "mcpServers",
    },
    {
      filePath: path.join(env.homeDir, ".claude.json"),
      ide: "claude-code",
      key: "mcpServers",
    },
  ];

  for (const source of sources) {
    const { data, warning } = readJson(source.filePath);
    if (warning !== undefined) {
      warnings.push(warning);
      continue;
    }
    if (data === undefined) continue;
    const entries = (data as Record<string, unknown>)[source.key];
    servers.push(...serversFromEntries(entries, source.ide, source.filePath));
  }

  // Same-name-different-config detection compares the redacted shape only
  // (transport + target); secret values never participate.
  const byName = new Map<string, McpServerView[]>();
  for (const server of servers) {
    const list = byName.get(server.name) ?? [];
    list.push(server);
    byName.set(server.name, list);
  }
  const findings: string[] = [];
  for (const [name, group] of [...byName.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const shapes = new Set(group.map((s) => `${s.transport}\0${s.target}`));
    if (shapes.size > 1) {
      findings.push(
        `MCP server "${name}" is configured differently across ${group
          .map((s) => s.ide)
          .join(", ")} — the IDEs are not talking to the same thing.`,
      );
    }
  }

  return { servers, findings, warnings };
}

export function discoverPlugins(env: McpEnvironment): PluginInventory {
  const plugins: PluginView[] = [];
  const warnings: string[] = [];

  const configPath = path.join(env.homeDir, ".config", "opencode", "opencode.json");
  const { data, warning } = readJson(configPath);
  if (warning !== undefined) warnings.push(warning);
  if (data !== undefined) {
    const declared = (data as Record<string, unknown>)["plugin"];
    if (Array.isArray(declared)) {
      for (const item of declared) {
        if (typeof item === "string") {
          plugins.push({
            ide: "opencode",
            name: item,
            detail: "declared in opencode.json",
          });
        }
      }
    }
  }

  const pluginsDir = path.join(env.homeDir, ".config", "opencode", "plugins");
  try {
    for (const name of fs.readdirSync(pluginsDir).sort()) {
      if (name === "node_modules") continue;
      plugins.push({
        ide: "opencode",
        name,
        detail: "file in plugins directory",
      });
    }
  } catch {
    // Absent directory: absent evidence.
  }

  return { plugins, warnings };
}
