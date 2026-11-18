/**
 * Claude Code integration. Writes a `reelforge` entry under `mcpServers` in either the
 * user config (~/.claude.json) or a project `.mcp.json`, preserving all other servers and
 * settings, with a backup. Never touches unrelated keys.
 */

import { existsSync } from "node:fs";
import { which } from "./paths.js";
import { claudeProjectConfigPath, claudeUserConfigPath } from "./paths.js";
import { backup, deepEqual, readJson, validateContains, writeJson } from "./jsonfile.js";
import type { ConnectOptions, ConnectResult, DetectResult, McpCommand } from "./types.js";

export function detectClaudeCode(scope: { projectDir?: string } = {}): DetectResult {
  const cliPath = which("claude");
  const configPath = scope.projectDir
    ? claudeProjectConfigPath(scope.projectDir)
    : claudeUserConfigPath();
  const configExists = existsSync(configPath);
  let configured = false;
  if (configExists) {
    try {
      const json = readJson(configPath);
      const servers = (json.mcpServers ?? {}) as Record<string, unknown>;
      configured = "reelforge" in servers;
    } catch {
      /* unreadable → treat as not configured */
    }
  }
  return {
    kind: "claude-code",
    installed: !!cliPath,
    cliPath,
    configPath,
    configExists,
    configured,
  };
}

function claudeEntry(mcp: McpCommand): Record<string, unknown> {
  const entry: Record<string, unknown> = { command: mcp.command, args: mcp.args };
  if (mcp.env && Object.keys(mcp.env).length) entry.env = mcp.env;
  return entry;
}

export function connectClaudeCode(
  opts: ConnectOptions & { projectDir?: string },
): ConnectResult {
  const serverName = opts.serverName ?? "reelforge";
  const configPath =
    opts.configPath ??
    (opts.projectDir ? claudeProjectConfigPath(opts.projectDir) : claudeUserConfigPath());

  const config = readJson(configPath);
  const servers = { ...((config.mcpServers as Record<string, unknown>) ?? {}) };
  const nextEntry = claudeEntry(opts.mcp);

  if (deepEqual(servers[serverName], nextEntry)) {
    return { kind: "claude-code", configPath, changed: false, action: "unchanged", message: "ReelForge already configured for Claude Code." };
  }
  const action = serverName in servers ? "updated" : "added";
  servers[serverName] = nextEntry;
  const nextConfig = { ...config, mcpServers: servers };

  if (opts.dryRun) {
    return { kind: "claude-code", configPath, changed: true, action: "dry-run", message: `Would ${action} the reelforge MCP server in ${configPath}.` };
  }

  const backupPath = backup(configPath);
  writeJson(configPath, nextConfig);
  if (!validateContains(configPath, ["mcpServers", serverName, "command"])) {
    throw new Error("validation failed: reelforge entry not found after write");
  }
  return {
    kind: "claude-code",
    configPath,
    backupPath,
    changed: true,
    action,
    message: `${action === "added" ? "Added" : "Updated"} the reelforge MCP server in Claude Code${backupPath ? ` (backup: ${backupPath})` : ""}.`,
  };
}

export function disconnectClaudeCode(opts: { serverName?: string; configPath?: string; projectDir?: string }): ConnectResult {
  const serverName = opts.serverName ?? "reelforge";
  const configPath = opts.configPath ?? (opts.projectDir ? claudeProjectConfigPath(opts.projectDir) : claudeUserConfigPath());
  const config = readJson(configPath);
  const servers = { ...((config.mcpServers as Record<string, unknown>) ?? {}) };
  if (!(serverName in servers)) {
    return { kind: "claude-code", configPath, changed: false, action: "unchanged", message: "No reelforge entry to remove." };
  }
  const backupPath = backup(configPath);
  delete servers[serverName];
  writeJson(configPath, { ...config, mcpServers: servers });
  return { kind: "claude-code", configPath, backupPath, changed: true, action: "removed", message: "Removed the reelforge MCP server from Claude Code." };
}
