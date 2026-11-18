/**
 * Silence detection via FFmpeg's `silencedetect` filter. Returns the SPEECH (non-silent)
 * segments, used for silence removal and auto-rough-cut assembly.
 */

import { secondsToTicks, type Ticks } from "@reelforge/engine";
import { FfmpegNotFoundError, runRaw, type FfmpegTools } from "./ffmpeg.js";

export interface Segment {
  startTick: Ticks;
  endTick: Ticks;
}

/**
 * Parse `silencedetect` stderr into non-silent (speech) segments (pure, unit-tested).
 * `silencedetect` logs `silence_start: X` and `silence_end: Y`. Speech is the complement
 * over [0, totalSec].
 */
export function parseSilence(stderr: string, totalSec: number): Segment[] {
  const starts: number[] = [];
  const ends: number[] = [];
  const startRe = /silence_start:\s*([-\d.]+)/g;
  const endRe = /silence_end:\s*([-\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = startRe.exec(stderr))) starts.push(Math.max(0, Number(m[1])));
  while ((m = endRe.exec(stderr))) ends.push(Number(m[1]));

  // Build silence intervals, then invert to speech.
  const silences: [number, number][] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]!;
    const e = i < ends.length ? ends[i]! : totalSec; // trailing silence to end
    if (e > s) silences.push([s, e]);
  }
  silences.sort((a, b) => a[0] - b[0]);

  const speech: Segment[] = [];
  let cursor = 0;
  for (const [s, e] of silences) {
    if (s > cursor) speech.push({ startTick: secondsToTicks(cursor), endTick: secondsToTicks(s) });
    cursor = Math.max(cursor, e);
  }
  if (cursor < totalSec) speech.push({ startTick: secondsToTicks(cursor), endTick: secondsToTicks(totalSec) });
  return speech.filter((seg) => seg.endTick > seg.startTick);
}

export async function detectSpeechSegments(
  tools: FfmpegTools,
  src: string,
  totalSec: number,
  opts: { noiseDb?: number; minSilenceSec?: number } = {},
): Promise<Segment[]> {
  if (!tools.ffmpeg) throw new FfmpegNotFoundError("ffmpeg");
  const noise = opts.noiseDb ?? -30;
  const minSilence = opts.minSilenceSec ?? 0.5;
  const res = await runRaw(
    tools.ffmpeg,
    [
      "-hide_banner", "-i", src,
      "-af", `silencedetect=noise=${noise}dB:d=${minSilence}`,
      "-f", "null", isWindowsNull(),
    ],
    { timeoutMs: 300_000 },
  );
  return parseSilence(res.stderr, totalSec);
}

function isWindowsNull(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}
