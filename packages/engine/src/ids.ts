/**
 * Deterministic-friendly id generation. Uses crypto.randomUUID when available; tests can
 * inject a seeded generator via `setIdGenerator` for reproducible fixtures.
 */

export type IdGenerator = (prefix: string) => string;

let generator: IdGenerator = (prefix: string) => {
  const uuid =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix}_${uuid}`;
};

export function newId(prefix: string): string {
  return generator(prefix);
}

/** Override id generation (used by tests for deterministic output). Returns a restore fn. */
export function setIdGenerator(gen: IdGenerator): () => void {
  const prev = generator;
  generator = gen;
  return () => {
    generator = prev;
  };
}

/** A simple deterministic counter generator for tests. */
export function createSeededIdGenerator(): IdGenerator {
  const counters = new Map<string, number>();
  return (prefix: string) => {
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);
    return `${prefix}_${n}`;
  };
}
