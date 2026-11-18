/**
 * Rational, integer-tick time model.
 *
 * All timeline positions and durations in ReelForge are integer **ticks**, not floats,
 * to eliminate cumulative drift across cuts, speed changes, and exports.
 *
 * TICK_RATE is 90_000 (the MPEG transport standard). It exactly represents common
 * integer frame rates (24/25/30/50/60) and 29.97 (30000/1001 → 3003 ticks/frame).
 * Fractional rates that don't divide evenly (e.g. 23.976) are rounded per-frame; drift
 * is bounded to sub-tick and never accumulates because positions are always absolute.
 */

export const TICK_RATE = 90_000 as const;

export type Ticks = number; // integer ticks; branding kept lightweight for ergonomics

/** Supported project frame rates (numerator/denominator kept exact where it matters). */
export const FPS_PRESETS = [24, 25, 30, 50, 60, 23.976, 29.97, 59.94] as const;
export type Fps = number;

export function secondsToTicks(seconds: number): Ticks {
  if (!Number.isFinite(seconds)) throw new RangeError(`seconds not finite: ${seconds}`);
  return Math.round(seconds * TICK_RATE);
}

export function ticksToSeconds(ticks: Ticks): number {
  return ticks / TICK_RATE;
}

/** Ticks per single frame at the given fps (rounded to nearest integer tick). */
export function ticksPerFrame(fps: Fps): Ticks {
  if (!(fps > 0)) throw new RangeError(`fps must be > 0: ${fps}`);
  return Math.round(TICK_RATE / fps);
}

export function framesToTicks(frames: number, fps: Fps): Ticks {
  if (!Number.isInteger(frames)) throw new RangeError(`frames must be integer: ${frames}`);
  return Math.round((frames * TICK_RATE) / fps);
}

export function ticksToFrames(ticks: Ticks, fps: Fps): number {
  return Math.round((ticks * fps) / TICK_RATE);
}

/** Snap an arbitrary tick value to the nearest frame boundary for the given fps. */
export function snapToFrame(ticks: Ticks, fps: Fps): Ticks {
  const tpf = ticksPerFrame(fps);
  return Math.round(ticks / tpf) * tpf;
}

export function clampTicks(value: Ticks, min: Ticks, max: Ticks): Ticks {
  return Math.min(Math.max(value, min), max);
}

/** Format ticks as HH:MM:SS.mmm for logs/UI debugging. */
export function formatTicks(ticks: Ticks): string {
  const totalMs = Math.round(ticksToSeconds(ticks) * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const m = Math.floor(totalSec / 60) % 60;
  const h = Math.floor(totalSec / 3600);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(h)}:${p(m)}:${p(s)}.${p(ms, 3)}`;
}
