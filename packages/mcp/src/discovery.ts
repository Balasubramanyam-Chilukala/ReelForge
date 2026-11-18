/**
 * Backend discovery for the MCP server. Finds the running ReelForge daemon's bridge via
 * (1) explicit env (REELFORGE_BRIDGE_PORT + REELFORGE_BRIDGE_TOKEN), or (2) the state file
 * the daemon publishes. Kept dependency-light (no backend/sqlite import) so the MCP server
 * stays a thin adapter.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface BridgeEndpoint {
  port: number;
  token: string;
}

function defaultStateFile(): string {
  if (process.env.REELFORGE_STATE_FILE) return process.env.REELFORGE_STATE_FILE;
  const app = "ReelForge";
  let dir: string;
  if (process.env.REELFORGE_RUNTIME_DIR) dir = process.env.REELFORGE_RUNTIME_DIR;
  else if (process.env.REELFORGE_DATA_DIR) dir = process.env.REELFORGE_DATA_DIR;
  else if (process.platform === "win32")
    dir = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), app);
  else if (process.platform === "darwin")
    dir = join(homedir(), "Library", "Application Support", app);
  else dir = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), app.toLowerCase());
  return join(dir, "bridge.json");
}

export function discoverBridge(): BridgeEndpoint | undefined {
  const envPort = process.env.REELFORGE_BRIDGE_PORT;
  const envToken = process.env.REELFORGE_BRIDGE_TOKEN;
  if (envPort && envToken) return { port: Number(envPort), token: envToken };

  const file = defaultStateFile();
  if (!existsSync(file)) return undefined;
  try {
    const state = JSON.parse(readFileSync(file, "utf8")) as { port: number; token: string };
    if (state.port && state.token) return { port: state.port, token: state.token };
  } catch {
    /* ignore malformed state */
  }
  return undefined;
}
