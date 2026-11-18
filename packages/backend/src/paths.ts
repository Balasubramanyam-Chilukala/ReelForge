/**
 * Cross-platform application data directories. Never hardcodes OS-specific paths; uses the
 * conventional per-OS app-data locations with env overrides for tests.
 */

import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

const APP = "ReelForge";

export function appDataDir(): string {
  const override = process.env.REELFORGE_DATA_DIR;
  if (override) return override;
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(base, APP);
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP);
  }
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, APP.toLowerCase());
}

export function cacheDir(): string {
  const override = process.env.REELFORGE_CACHE_DIR;
  if (override) return override;
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(base, APP, "Cache");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", APP);
  }
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  return join(base, APP.toLowerCase());
}

export function runtimeDir(): string {
  // Where the bridge state file lives so clients (MCP/UI) can discover it.
  return process.env.REELFORGE_RUNTIME_DIR ?? appDataDir();
}

export function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return process.env.REELFORGE_DB ?? join(ensureDir(appDataDir()), "reelforge.sqlite");
}

export function projectsDir(): string {
  return ensureDir(join(appDataDir(), "projects"));
}

export function tmpWorkDir(): string {
  return ensureDir(join(tmpdir(), "reelforge-work"));
}
