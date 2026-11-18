export type AgentKind = "claude-code" | "opencode";

export interface McpCommand {
  /** Executable, e.g. "node" or "reelforge-mcp". */
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface DetectResult {
  kind: AgentKind;
  installed: boolean;
  cliPath?: string;
  configPath: string;
  configExists: boolean;
  /** True if a `reelforge` MCP entry already exists in the config. */
  configured: boolean;
}

export type ConnectAction = "added" | "updated" | "unchanged" | "removed" | "dry-run";

export interface ConnectResult {
  kind: AgentKind;
  configPath: string;
  backupPath?: string;
  changed: boolean;
  action: ConnectAction;
  message: string;
}

export interface ConnectOptions {
  serverName?: string;
  mcp: McpCommand;
  /** Override the config file path (used by tests). */
  configPath?: string;
  /** If true, compute changes but do not write. */
  dryRun?: boolean;
}
