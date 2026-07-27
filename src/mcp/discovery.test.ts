import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverMcpServers, discoverPlugins } from "./discovery.js";

/**
 * ADR-0007: MCP servers and plugins are a read-only inventory. Secret
 * values (env vars, headers, URL query strings) must never enter the view
 * model — only key names survive.
 */

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "skillvault-mcp-"));
});

afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const writeJson = (rel: string, data: unknown): void => {
  const full = path.join(home, ...rel.split("/"));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, JSON.stringify(data), "utf8");
};

describe("discoverMcpServers", () => {
  it("aggregates servers across IDE configs with secret redaction", () => {
    writeJson(".config/opencode/opencode.json", {
      mcp: {
        context7: { type: "local", command: ["npx", "context7"], enabled: true },
      },
    });
    writeJson(".gemini/antigravity/mcp_config.json", {
      mcpServers: {
        cloudflare: {
          command: "npx",
          args: ["mcp-cloudflare"],
          env: { CLOUDFLARE_API_TOKEN: "sekrit-token-value" },
        },
      },
    });
    writeJson(".gemini/antigravity-ide/mcp_config.json", {
      mcpServers: {
        context7: {
          serverUrl: "https://mcp.context7.com/mcp?apiKey=super-secret",
          headers: { Authorization: "Bearer abc123" },
        },
      },
    });
    writeJson(".claude.json", {
      numStartups: 5,
      mcpServers: {
        context7: { type: "http", url: "https://mcp.context7.com/mcp", headers: {} },
      },
    });

    const inventory = discoverMcpServers({ homeDir: home });
    expect(inventory.warnings).toEqual([]);
    expect(inventory.servers).toHaveLength(4);

    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toContain("sekrit-token-value");
    expect(serialized).not.toContain("abc123");
    expect(serialized).not.toContain("super-secret");

    const cloudflare = inventory.servers.find((s) => s.name === "cloudflare");
    expect(cloudflare?.ide).toBe("antigravity");
    expect(cloudflare?.transport).toBe("stdio");
    expect(cloudflare?.secretKeys).toEqual(["CLOUDFLARE_API_TOKEN"]);

    const remote = inventory.servers.find(
      (s) => s.name === "context7" && s.ide === "antigravity-ide",
    );
    expect(remote?.transport).toBe("remote");
    // Query string stripped: it may embed credentials.
    expect(remote?.target).toBe("https://mcp.context7.com/mcp");
    expect(remote?.secretKeys).toEqual(["Authorization"]);
  });

  it("flags the same server name configured differently across IDEs", () => {
    writeJson(".config/opencode/opencode.json", {
      mcp: { context7: { type: "local", command: ["npx", "context7"] } },
    });
    writeJson(".claude.json", {
      mcpServers: {
        context7: { type: "http", url: "https://mcp.context7.com/mcp" },
      },
    });
    const inventory = discoverMcpServers({ homeDir: home });
    expect(inventory.findings).toHaveLength(1);
    expect(inventory.findings[0]).toContain("context7");
  });

  it("identical configs across IDEs produce no finding", () => {
    writeJson(".gemini/antigravity/mcp_config.json", {
      mcpServers: { quran: { serverUrl: "https://mcp.example.com/quran" } },
    });
    writeJson(".gemini/antigravity-ide/mcp_config.json", {
      mcpServers: { quran: { serverUrl: "https://mcp.example.com/quran" } },
    });
    const inventory = discoverMcpServers({ homeDir: home });
    expect(inventory.findings).toEqual([]);
  });

  it("missing configs are absent evidence; malformed ones are warnings", () => {
    const empty = discoverMcpServers({ homeDir: home });
    expect(empty.servers).toEqual([]);
    expect(empty.warnings).toEqual([]);

    writeJson(".config/opencode/opencode.json", {});
    fs.writeFileSync(path.join(home, ".claude.json"), "{broken", "utf8");
    const withBroken = discoverMcpServers({ homeDir: home });
    expect(withBroken.servers).toEqual([]);
    expect(withBroken.warnings).toHaveLength(1);
    expect(withBroken.warnings[0]).toContain(".claude.json");
  });
});

describe("discoverPlugins", () => {
  it("lists opencode plugin entries and plugin files", () => {
    writeJson(".config/opencode/opencode.json", {
      plugin: ["opencode-antigravity-auth@1.1.4", "./plugins/agentrouter-fix.js"],
    });
    const pluginsDir = path.join(home, ".config", "opencode", "plugins");
    fs.mkdirSync(pluginsDir, { recursive: true });
    fs.writeFileSync(path.join(pluginsDir, "agentrouter-fix.js"), "// x", "utf8");

    const inventory = discoverPlugins({ homeDir: home });
    expect(inventory.plugins).toEqual([
      {
        ide: "opencode",
        name: "opencode-antigravity-auth@1.1.4",
        detail: "declared in opencode.json",
      },
      {
        ide: "opencode",
        name: "./plugins/agentrouter-fix.js",
        detail: "declared in opencode.json",
      },
      {
        ide: "opencode",
        name: "agentrouter-fix.js",
        detail: "file in plugins directory",
      },
    ]);
  });

  it("returns empty for a machine without plugins", () => {
    expect(discoverPlugins({ homeDir: home }).plugins).toEqual([]);
  });
});
