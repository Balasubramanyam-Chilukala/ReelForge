/**
 * Persistence. A narrow `Database` port abstracts the store so the SQLite implementation
 * (node:sqlite, zero native deps) can be swapped (e.g. better-sqlite3) without touching
 * the service. Schema is created idempotently; a `meta` table tracks the DB version.
 */

import { createRequire } from "node:module";
import type { ProjectDoc } from "@reelforge/engine";
import type { ActivityEntry, ProjectSummary } from "@reelforge/shared";

// node:sqlite is a newer Node builtin that some bundlers don't yet recognize as external.
// Load it through createRequire so no bundler attempts to statically resolve it.
interface DatabaseSyncCtor {
  new (path: string): {
    exec(sql: string): void;
    prepare(sql: string): { get(...a: unknown[]): unknown; all(...a: unknown[]): unknown[]; run(...a: unknown[]): unknown };
    close(): void;
  };
}
// Works both as native ESM (dist/*.js) and inside a CJS esbuild bundle: in a CJS bundle
// `require` is a function and is used directly (the createRequire branch is never reached,
// so `import.meta.url` is never evaluated there).
const nodeRequire =
  typeof require === "function" ? require : createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire("node:sqlite") as { DatabaseSync: DatabaseSyncCtor };
type DatabaseSync = InstanceType<DatabaseSyncCtor>;

export interface StoredProject {
  id: string;
  name: string;
  schemaVersion: number;
  updatedAt: string;
  createdAt: string;
  doc: ProjectDoc;
}

export interface ExportRecord {
  id: string;
  projectId: string;
  outputPath: string;
  createdAt: string;
  durationSec: number;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface Database {
  upsertProject(doc: ProjectDoc): void;
  getProject(id: string): StoredProject | undefined;
  listProjects(): ProjectSummary[];
  deleteProject(id: string): void;
  appendActivity(projectId: string, entry: ActivityEntry): void;
  listActivity(projectId: string, limit?: number): ActivityEntry[];
  recordExport(rec: ExportRecord): void;
  listExports(projectId: string): ExportRecord[];
  close(): void;
}

const DB_VERSION = 1;

export class SqliteDatabase implements Database {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        doc TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        at TEXT NOT NULL,
        source TEXT NOT NULL,
        label TEXT NOT NULL,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(project_id, id);
      CREATE TABLE IF NOT EXISTS exports (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        output_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        duration_sec REAL NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL
      );
    `);
    const row = this.db.prepare("SELECT value FROM meta WHERE key = 'db_version'").get() as
      | { value: string }
      | undefined;
    if (!row) {
      this.db
        .prepare("INSERT INTO meta (key, value) VALUES ('db_version', ?)")
        .run(String(DB_VERSION));
    }
  }

  upsertProject(doc: ProjectDoc): void {
    this.db
      .prepare(
        `INSERT INTO projects (id, name, schema_version, created_at, updated_at, doc)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           schema_version = excluded.schema_version,
           updated_at = excluded.updated_at,
           doc = excluded.doc`,
      )
      .run(doc.id, doc.name, doc.schemaVersion, doc.createdAt, doc.updatedAt, JSON.stringify(doc));
  }

  getProject(id: string): StoredProject | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | { id: string; name: string; schema_version: number; created_at: string; updated_at: string; doc: string }
      | undefined;
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      doc: JSON.parse(row.doc) as ProjectDoc,
    };
  }

  listProjects(): ProjectSummary[] {
    const rows = this.db
      .prepare("SELECT doc FROM projects ORDER BY updated_at DESC")
      .all() as { doc: string }[];
    return rows.map((r) => {
      const doc = JSON.parse(r.doc) as ProjectDoc;
      return {
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        durationTicks: doc.timeline.durationTicks,
        trackCount: doc.timeline.tracks.length,
        mediaCount: doc.media.length,
      };
    });
  }

  deleteProject(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM activity WHERE project_id = ?").run(id);
    this.db.prepare("DELETE FROM exports WHERE project_id = ?").run(id);
  }

  appendActivity(projectId: string, entry: ActivityEntry): void {
    this.db
      .prepare(
        "INSERT INTO activity (project_id, at, source, label, detail) VALUES (?, ?, ?, ?, ?)",
      )
      .run(projectId, entry.at, entry.source, entry.label, entry.detail ?? null);
  }

  listActivity(projectId: string, limit = 200): ActivityEntry[] {
    const rows = this.db
      .prepare(
        "SELECT at, source, label, detail FROM activity WHERE project_id = ? ORDER BY id DESC LIMIT ?",
      )
      .all(projectId, limit) as { at: string; source: string; label: string; detail: string | null }[];
    return rows
      .map((r) => ({
        at: r.at,
        source: r.source as ActivityEntry["source"],
        label: r.label,
        detail: r.detail ?? undefined,
      }))
      .reverse();
  }

  recordExport(rec: ExportRecord): void {
    this.db
      .prepare(
        `INSERT INTO exports (id, project_id, output_path, created_at, duration_sec, width, height, size_bytes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(rec.id, rec.projectId, rec.outputPath, rec.createdAt, rec.durationSec, rec.width, rec.height, rec.sizeBytes);
  }

  listExports(projectId: string): ExportRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM exports WHERE project_id = ? ORDER BY created_at DESC")
      .all(projectId) as any[];
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      outputPath: r.output_path,
      createdAt: r.created_at,
      durationSec: r.duration_sec,
      width: r.width,
      height: r.height,
      sizeBytes: r.size_bytes,
    }));
  }

  close(): void {
    this.db.close();
  }
}

/** In-memory database for tests. */
export function createMemoryDatabase(): Database {
  return new SqliteDatabase(":memory:");
}
