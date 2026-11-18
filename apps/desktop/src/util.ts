import { TICK_RATE, formatTicks, ticksToSeconds } from "@reelforge/engine";
import type { TrackKind } from "@reelforge/engine";

export { TICK_RATE, formatTicks, ticksToSeconds };

export function secondsFromPx(px: number, pxPerSecond: number): number {
  return px / pxPerSecond;
}
export function ticksToPx(ticks: number, pxPerSecond: number): number {
  return ticksToSeconds(ticks) * pxPerSecond;
}
export function pxToTicks(px: number, pxPerSecond: number): number {
  return Math.round((px / pxPerSecond) * TICK_RATE);
}

export function trackColorVar(kind: TrackKind): string {
  switch (kind) {
    case "video": return "var(--track-video)";
    case "audio": return "var(--track-audio)";
    case "text": return "var(--track-text)";
    case "overlay": return "var(--track-overlay)";
    default: return "var(--bg-3)";
  }
}

export function humanDuration(ticks: number): string {
  const s = ticksToSeconds(ticks);
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
