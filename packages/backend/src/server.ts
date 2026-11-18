/**
 * Backend bootstrap: wire the database, service, and bridge together and publish the
 * state file for clients to discover.
 */

import { SqliteDatabase, type Database } from "./db.js";
import { ProjectService } from "./service.js";
import { startBridge, type StartedBridge } from "./bridge.js";
import { clearState, writeState } from "./statefile.js";
import { dbPath } from "./paths.js";

export interface BackendHandle {
  service: ProjectService;
  bridge: StartedBridge;
  db: Database;
  stop: () => Promise<void>;
}

export interface StartBackendOptions {
  version?: string;
  dbFile?: string;
  port?: number;
  publishState?: boolean;
}

export async function startBackend(opts: StartBackendOptions = {}): Promise<BackendHandle> {
  const db = new SqliteDatabase(opts.dbFile ?? dbPath());
  // Create bridge-less service first so we can pass broadcast into it.
  let bridge: StartedBridge;
  const service = await ProjectService.create(db, {
    version: opts.version ?? "0.1.0",
    emit: (event) => bridge?.broadcast(event),
  });
  bridge = await startBridge(service, { port: opts.port });

  if (opts.publishState ?? true) {
    writeState({
      port: bridge.port,
      token: bridge.token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
      version: opts.version ?? "0.1.0",
    });
  }

  return {
    service,
    bridge,
    db,
    stop: async () => {
      await bridge.close();
      db.close();
      if (opts.publishState ?? true) clearState();
    },
  };
}
