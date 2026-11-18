/**
 * Bridge discovery. The daemon writes {port, token, pid} to a well-known file in the
 * runtime dir; the MCP server and UI read it to connect. The token authorizes local
 * requests. The file is written with best-effort restrictive permissions.
 */

import { chmodSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, runtimeDir } from "./paths.js";

export interface BridgeState {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
  version: string;
}

export function stateFilePath(): string {
  return process.env.REELFORGE_STATE_FILE ?? join(ensureDir(runtimeDir()), "bridge.json");
}

export function writeState(state: BridgeState): string {
  const path = stateFilePath();
  writeFileSync(path, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best effort on platforms without POSIX perms */
  }
  return path;
}

export function readState(): BridgeState | undefined {
  const path = stateFilePath();
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as BridgeState;
  } catch {
    return undefined;
  }
}

export function clearState(): void {
  const path = stateFilePath();
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* ignore */
  }
}
