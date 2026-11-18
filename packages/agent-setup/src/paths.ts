import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { accessSync, constants } from "node:fs";

export function claudeUserConfigPath(): string {
  // Claude Code stores user-scope MCP servers in ~/.claude.json
  return process.env.REELFORGE_CLAUDE_CONFIG ?? join(homedir(), ".claude.json");
}

export function claudeProjectConfigPath(projectDir: string): string {
  return join(projectDir, ".mcp.json");
}

export function openCodeUserConfigPath(): string {
  if (process.env.REELFORGE_OPENCODE_CONFIG) return process.env.REELFORGE_OPENCODE_CONFIG;
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(base, "opencode", "opencode.json");
}

/** Find an executable on PATH (checks platform extensions on Windows). */
export function which(name: string): string | undefined {
  const exts = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, name + ext);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return undefined;
}
