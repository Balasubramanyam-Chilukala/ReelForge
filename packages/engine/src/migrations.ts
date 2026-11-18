/**
 * Versioned project migrations. Each migration upgrades a doc by exactly one schema
 * version. `migrate` applies them in sequence up to CURRENT_SCHEMA_VERSION.
 *
 * When the schema changes: bump CURRENT_SCHEMA_VERSION in schema.ts, add a migration here
 * from the previous version to the new one, and add a fixture test.
 */

import { invalid } from "./errors.js";
import { CURRENT_SCHEMA_VERSION, type ProjectDoc } from "./schema.js";

type Migration = (doc: any) => any;

/** migrations[n] upgrades a doc at version n -> n+1. */
const migrations: Record<number, Migration> = {
  // Example for the future:
  // 1: (doc) => ({ ...doc, schemaVersion: 2, settings: { ...doc.settings, newField: 0 } }),
};

export interface MigrationResult {
  doc: ProjectDoc;
  migrated: boolean;
  fromVersion: number;
}

export function migrate(input: unknown): MigrationResult {
  if (typeof input !== "object" || input === null) {
    throw invalid("project document must be an object");
  }
  let doc = input as any;
  if (typeof doc.schemaVersion !== "number") {
    throw invalid("project document missing schemaVersion");
  }
  const fromVersion = doc.schemaVersion;
  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw invalid(
      `project schema version ${fromVersion} is newer than supported ${CURRENT_SCHEMA_VERSION}; upgrade ReelForge`,
    );
  }
  let migrated = false;
  while (doc.schemaVersion < CURRENT_SCHEMA_VERSION) {
    const m = migrations[doc.schemaVersion];
    if (!m) {
      throw invalid(`no migration path from schema version ${doc.schemaVersion}`);
    }
    doc = m(doc);
    migrated = true;
  }
  return { doc: doc as ProjectDoc, migrated, fromVersion };
}
