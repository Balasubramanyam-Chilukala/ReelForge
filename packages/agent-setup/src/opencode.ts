/**
 * OpenCode integration. Writes a `reelforge` entry under the top-level `mcp` object in
 * opencode.json using the stable local-server schema:
 *   "reelforge": { "type": "local", "command": ["node", "...reelforge-mcp.js"], "enabled": true }
 * Preserves all other servers/keys (including `$schema`), with a backup.
 *
 * Note: OpenCode v2 nests servers under `mcp.servers` and uses `disabled` instead of
 * `enabled`. Detect the installed version before assuming a schema; this writer targets the
 * current stable (v1) schema and is validated after writing.
 */

import { existsSync } from "node:fs";
import { openCodeUserConfigPath, which } from "./paths.js";
import { backup, deepEqual, readJson, validateContains, writeJson } from "./jsonfile.js";
import type { ConnectOptions, ConnectResult, DetectResult, McpCommand } from "./types.js";

export function detectOpenCode(): DetectResult {
  const cliPath = which("opencode");
  const configPath = openCodeUserConfigPath();
  const configExists = existsSync(configPath);
  let configured = false;
  if (configExists) {
    try {
      const json = readJson(configPath);
      const mcp = (json.mcp ?? {}) as Record<string, unknown>;
      configured = "reelforge" in mcp;
    } catch {
      /* ignore */
    }
  }
  return { kind: "opencode", installed: !!cliPath, cliPath, configPath, configExists, configured };
}

function openCodeEntry(mcp: McpCommand): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    type: "local",
    command: [mcp.command, ...mcp.args],
    enabled: true,
  };
  if (mcp.env && Object.keys(mcp.env).length) entry.environment = mcp.env;
  return entry;
}

export function connectOpenCode(opts: ConnectOptions): ConnectResult {
  const serverName = opts.serverName ?? "reelforge";
  const configPath = opts.configPath ?? openCodeUserConfigPath();

  const config = readJson(configPath);
  const mcp = { ...((config.mcp as Record<string, unknown>) ?? {}) };
  const nextEntry = openCodeEntry(opts.mcp);

  if (deepEqual(mcp[serverName], nextEntry)) {
    return { kind: "opencode", configPath, changed: false, action: "unchanged", message: "ReelForge already configured for OpenCode." };
  }
  const action = serverName in mcp ? "updated" : "added";
  mcp[serverName] = nextEntry;
  // Preserve $schema and everything else; ensure a schema hint if absent.
  const nextConfig: Record<string, unknown> = { ...config, mcp };
  if (!nextConfig.$schema) nextConfig.$schema = "https://opencode.ai/config.json";

  if (opts.dryRun) {
    return { kind: "opencode", configPath, changed: true, action: "dry-run", message: `Would ${action} the reelforge MCP server in ${configPath}.` };
  }

  const backupPath = backup(configPath);
  writeJson(configPath, nextConfig);
  if (!validateContains(configPath, ["mcp", serverName, "type"])) {
    throw new Error("validation failed: reelforge entry not found after write");
  }
  return {
    kind: "opencode",
    configPath,
    backupPath,
    changed: true,
    action,
    message: `${action === "added" ? "Added" : "Updated"} the reelforge MCP server in OpenCode${backupPath ? ` (backup: ${backupPath})` : ""}.`,
  };
}

export function disconnectOpenCode(opts: { serverName?: string; configPath?: string }): ConnectResult {
  const serverName = opts.serverName ?? "reelforge";
  const configPath = opts.configPath ?? openCodeUserConfigPath();
  const config = readJson(configPath);
  const mcp = { ...((config.mcp as Record<string, unknown>) ?? {}) };
  if (!(serverName in mcp)) {
    return { kind: "opencode", configPath, changed: false, action: "unchanged", message: "No reelforge entry to remove." };
  }
  const backupPath = backup(configPath);
  delete mcp[serverName];
  writeJson(configPath, { ...config, mcp });
  return { kind: "opencode", configPath, backupPath, changed: true, action: "removed", message: "Removed the reelforge MCP server from OpenCode." };
}
