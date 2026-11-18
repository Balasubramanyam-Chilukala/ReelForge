import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  connectClaudeCode,
  connectOpenCode,
  disconnectClaudeCode,
  disconnectOpenCode,
} from "../src/index.js";

let dir: string;
const mcp = { command: "node", args: ["/abs/reelforge-mcp.js"] };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "reelforge-agent-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Claude Code config", () => {
  it("adds reelforge preserving existing servers and backing up", async () => {
    const cfg = join(dir, ".claude.json");
    await writeFile(cfg, JSON.stringify({ mcpServers: { other: { command: "x", args: [] } }, someOtherSetting: 42 }));

    const res = connectClaudeCode({ mcp, configPath: cfg });
    expect(res.action).toBe("added");
    expect(res.backupPath).toBeTruthy();

    const written = JSON.parse(await readFile(cfg, "utf8"));
    expect(written.mcpServers.other).toBeTruthy(); // preserved
    expect(written.mcpServers.reelforge.command).toBe("node");
    expect(written.someOtherSetting).toBe(42); // unrelated settings preserved
  });

  it("is idempotent (second run makes no change)", async () => {
    const cfg = join(dir, ".claude.json");
    connectClaudeCode({ mcp, configPath: cfg });
    const second = connectClaudeCode({ mcp, configPath: cfg });
    expect(second.action).toBe("unchanged");
    expect(second.changed).toBe(false);
  });

  it("creates config from scratch when none exists", async () => {
    const cfg = join(dir, "nested", ".claude.json");
    const res = connectClaudeCode({ mcp, configPath: cfg });
    expect(res.action).toBe("added");
    const written = JSON.parse(await readFile(cfg, "utf8"));
    expect(written.mcpServers.reelforge.args).toEqual(["/abs/reelforge-mcp.js"]);
  });

  it("dry-run does not write", async () => {
    const cfg = join(dir, ".claude.json");
    const res = connectClaudeCode({ mcp, configPath: cfg, dryRun: true });
    expect(res.action).toBe("dry-run");
    await expect(readFile(cfg, "utf8")).rejects.toThrow();
  });

  it("disconnect removes only the reelforge entry", async () => {
    const cfg = join(dir, ".claude.json");
    await writeFile(cfg, JSON.stringify({ mcpServers: { other: { command: "x", args: [] }, reelforge: { command: "node", args: [] } } }));
    const res = disconnectClaudeCode({ configPath: cfg });
    expect(res.action).toBe("removed");
    const written = JSON.parse(await readFile(cfg, "utf8"));
    expect(written.mcpServers.reelforge).toBeUndefined();
    expect(written.mcpServers.other).toBeTruthy();
  });
});

describe("OpenCode config", () => {
  it("adds a local server with the correct schema, preserving others and $schema", async () => {
    const cfg = join(dir, "opencode.json");
    await writeFile(cfg, JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { existing: { type: "local", command: ["y"] } }, theme: "dark" }));

    const res = connectOpenCode({ mcp, configPath: cfg });
    expect(res.action).toBe("added");

    const written = JSON.parse(await readFile(cfg, "utf8"));
    expect(written.mcp.existing).toBeTruthy();
    expect(written.mcp.reelforge.type).toBe("local");
    expect(written.mcp.reelforge.command).toEqual(["node", "/abs/reelforge-mcp.js"]);
    expect(written.mcp.reelforge.enabled).toBe(true);
    expect(written.$schema).toBe("https://opencode.ai/config.json");
    expect(written.theme).toBe("dark");
  });

  it("adds $schema when missing and is idempotent", async () => {
    const cfg = join(dir, "opencode.json");
    const first = connectOpenCode({ mcp, configPath: cfg });
    expect(first.action).toBe("added");
    const written = JSON.parse(await readFile(cfg, "utf8"));
    expect(written.$schema).toBeTruthy();
    const second = connectOpenCode({ mcp, configPath: cfg });
    expect(second.action).toBe("unchanged");
  });

  it("disconnect removes only the reelforge entry", async () => {
    const cfg = join(dir, "opencode.json");
    await writeFile(cfg, JSON.stringify({ mcp: { reelforge: { type: "local", command: ["node"] }, keep: { type: "local", command: ["z"] } } }));
    const res = disconnectOpenCode({ configPath: cfg });
    expect(res.action).toBe("removed");
    const written = JSON.parse(await readFile(cfg, "utf8"));
    expect(written.mcp.reelforge).toBeUndefined();
    expect(written.mcp.keep).toBeTruthy();
  });
});
