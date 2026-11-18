#!/usr/bin/env node
/**
 * ReelForge backend daemon entry point. Starts the bridge, publishes the state file, and
 * runs until terminated. The desktop app spawns this; it can also be run standalone for
 * development and for MCP-only (headless) sessions.
 */

import { startBackend } from "../server.js";
import { stateFilePath } from "../statefile.js";

async function main(): Promise<void> {
  const portArg = process.argv.find((a) => a.startsWith("--port="));
  const port = portArg ? Number(portArg.split("=")[1]) : undefined;

  const handle = await startBackend({ version: "0.1.0", port });
  const { port: boundPort } = handle.bridge;
  // eslint-disable-next-line no-console
  console.log(
    `[reelforge-backend] listening on 127.0.0.1:${boundPort}\n` +
      `[reelforge-backend] state file: ${stateFilePath()}\n` +
      `[reelforge-backend] ffmpeg: ${JSON.stringify(handle.service.status().ffmpeg)}`,
  );

  const shutdown = async (signal: string) => {
    console.log(`[reelforge-backend] ${signal} received, shutting down`);
    await handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[reelforge-backend] fatal:", err);
  process.exit(1);
});
