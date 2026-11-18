import { describe, expect, it } from "vitest";
import { migrate } from "../src/migrations.js";
import { createProject } from "../src/project.js";
import { CURRENT_SCHEMA_VERSION } from "../src/schema.js";

describe("migrations", () => {
  it("passes through a current-version doc unchanged", () => {
    const doc = createProject();
    const r = migrate(doc);
    expect(r.migrated).toBe(false);
    expect(r.doc.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("rejects a newer-than-supported schema", () => {
    const doc = { ...createProject(), schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(() => migrate(doc)).toThrow(/newer than supported/);
  });

  it("rejects a non-object", () => {
    expect(() => migrate(null)).toThrow();
    expect(() => migrate(42)).toThrow();
  });

  it("rejects a doc with no schemaVersion", () => {
    expect(() => migrate({ name: "x" })).toThrow(/schemaVersion/);
  });
});
