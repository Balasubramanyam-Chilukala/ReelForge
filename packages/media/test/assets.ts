/**
 * Programmatic test-asset generation using FFmpeg's lavfi sources (color bars + tone).
 * No copyrighted media is ever used. All generators no-op/skip when FFmpeg is absent.
 */

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { detectFfmpeg, runCapture, type FfmpegTools } from "../src/ffmpeg.js";

let cached: FfmpegTools | undefined;
export async function tools(): Promise<FfmpegTools> {
  if (!cached) cached = await detectFfmpeg();
  return cached;
}

export async function hasFfmpeg(): Promise<boolean> {
  const t = await tools();
  return !!(t.ffmpeg && t.ffprobe);
}

export interface SynthOptions {
  seconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  withAudio?: boolean;
}

/** Create a short test video (color bars + optional tone) at `outPath`. */
export async function makeTestVideo(outPath: string, opts: SynthOptions = {}): Promise<void> {
  const t = await tools();
  if (!t.ffmpeg) throw new Error("ffmpeg required for test asset generation");
  const sec = opts.seconds ?? 3;
  const w = opts.width ?? 640;
  const h = opts.height ?? 360;
  const fps = opts.fps ?? 30;
  await mkdir(dirname(outPath), { recursive: true });
  const args = [
    "-y", "-hide_banner",
    "-f", "lavfi", "-i", `testsrc=size=${w}x${h}:rate=${fps}:duration=${sec}`,
  ];
  if (opts.withAudio ?? true) {
    args.push("-f", "lavfi", "-i", `sine=frequency=440:duration=${sec}`);
  }
  args.push(
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-t", String(sec),
  );
  if (opts.withAudio ?? true) args.push("-c:a", "aac", "-shortest");
  args.push(outPath);
  await runCapture(t.ffmpeg, args, { timeoutMs: 60_000 });
}
