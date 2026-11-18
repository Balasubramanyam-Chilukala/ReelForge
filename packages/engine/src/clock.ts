/** Injectable clock so document timestamps are deterministic in tests. */

let clock: () => string = () => new Date().toISOString();

export function now(): string {
  return clock();
}

export function setClock(fn: () => string): () => void {
  const prev = clock;
  clock = fn;
  return () => {
    clock = prev;
  };
}
