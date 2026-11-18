#!/usr/bin/env node
/**
 * reelforge-connect — CLI to wire Claude Code and/or OpenCode to the reelforge-mcp server.
 * Used by the desktop app's Agent Integration wizard and available standalone.
 *
 * Usage:
 *   reelforge-connect --agent both --script /abs/path/to/reelforge-mcp.js
 *   reelforge-connect --agent claude --project .          # write project .mcp.json
 *   reelforge-connect --agent opencode --disconnect
 *   reelforge-connect --status
 */

import { connectClaudeCode, detectClaudeCode, disconnectClaudeCode } from "../claude.js";
import { connectOpenCode, detectOpenCode, disconnectOpenCode } from "../opencode.js";
import { buildMcpCommand, detectAgents } from "../index.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function main(): void {
  if (flag("status") || process.argv.length <= 2) {
    const overview = detectAgents(arg("project"));
    console.log(JSON.stringify(overview, null, 2));
    return;
  }

  const agent = arg("agent") ?? "both";
  const scriptPath = arg("script");
  const projectDir = arg("project");
  const dryRun = flag("dry-run");
  const disconnect = flag("disconnect");
  const mcp = buildMcpCommand({ scriptPath });

  const targets = agent === "both" ? ["claude", "opencode"] : [agent];
  for (const t of targets) {
    if (t === "claude") {
      const res = disconnect
        ? disconnectClaudeCode({ projectDir })
        : connectClaudeCode({ mcp, projectDir, dryRun });
      console.log(`[claude-code] ${res.action}: ${res.message}`);
    } else if (t === "opencode") {
      const res = disconnect ? disconnectOpenCode({}) : connectOpenCode({ mcp, dryRun });
      console.log(`[opencode] ${res.action}: ${res.message}`);
    } else {
      console.error(`unknown agent: ${t}`);
      process.exit(2);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(`reelforge-connect error: ${(err as Error).message}`);
  process.exit(1);
}
