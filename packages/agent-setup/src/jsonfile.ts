/** Safe JSON config read/merge/write with timestamped backups. */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8").trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`config at ${path} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function backup(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${path}.reelforge-backup-${stamp}`;
  copyFileSync(path, backupPath);
  return backupPath;
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/** Validate that a written config parses and contains the expected server key. */
export function validateContains(path: string, pathKeys: string[]): boolean {
  const json = readJson(path);
  let node: unknown = json;
  for (const key of pathKeys) {
    if (typeof node !== "object" || node === null || !(key in (node as object))) return false;
    node = (node as Record<string, unknown>)[key];
  }
  return node !== undefined;
}

/** Deep equality for plain JSON values. */
export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
