#!/usr/bin/env node
/**
 * reelforge-mcp — stdio MCP server entry point for Claude Code and OpenCode.
 *
 * Discovers the running ReelForge backend via the bridge state file (or
 * REELFORGE_BRIDGE_PORT + REELFORGE_BRIDGE_TOKEN), verifies the connection, then serves
 * the tool surface over stdio. Exits with a clear message if the backend is not running.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient } from "../client.js";
import { discoverBridge } from "../discovery.js";
import { createMcpServer } from "../server.js";

async function main(): Promise<void> {
  const endpoint = discoverBridge();
  if (!endpoint) {
    process.stderr.write(
      "[reelforge-mcp] ReelForge backend not found.\n" +
        "  Start the ReelForge app (or run `reelforge-backend`) first, or set\n" +
        "  REELFORGE_BRIDGE_PORT and REELFORGE_BRIDGE_TOKEN.\n",
    );
    process.exit(1);
  }
  const client = new BridgeClient(endpoint);
  if (!(await client.health())) {
    process.stderr.write("[reelforge-mcp] found bridge config but the backend is not responding.\n");
    process.exit(1);
  }
  const server = createMcpServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[reelforge-mcp] connected to ReelForge backend; serving tools over stdio.\n");
}

main().catch((err) => {
  process.stderr.write(`[reelforge-mcp] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
