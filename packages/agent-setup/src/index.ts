export * from "./types.js";
export * from "./paths.js";
export * from "./jsonfile.js";
export * from "./claude.js";
export * from "./opencode.js";

import { detectClaudeCode } from "./claude.js";
import { detectOpenCode } from "./opencode.js";
import type { DetectResult, McpCommand } from "./types.js";

export interface AgentsOverview {
  claudeCode: DetectResult;
  openCode: DetectResult;
}

export function detectAgents(projectDir?: string): AgentsOverview {
  return {
    claudeCode: detectClaudeCode({ projectDir }),
    openCode: detectOpenCode(),
  };
}

/**
 * Build the MCP launch command for the installed reelforge-mcp. If an absolute script path
 * is provided, launches it with node; otherwise relies on the `reelforge-mcp` bin on PATH.
 */
export function buildMcpCommand(opts: { scriptPath?: string; env?: Record<string, string> } = {}): McpCommand {
  if (opts.scriptPath) return { command: process.execPath, args: [opts.scriptPath], env: opts.env };
  return { command: "reelforge-mcp", args: [], env: opts.env };
}
