/**
 * Media analysis utilities: thumbnails, contact sheets, waveform peaks, scene detection,
 * and keyframe extraction. All require FFmpeg; each throws FfmpegNotFoundError otherwise.
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { secondsToTicks, type Ticks } from "@reelforge/engine";
import { FfmpegNotFoundError, runCapture, runRaw, type FfmpegTools } from "./ffmpeg.js";

const s3 = (n: number) => n.toFixed(3);

export async function generateThumbnail(
  tools: FfmpegTools,
  src: string,
  atSec: number,
  outPath: string,
  width = 320,
): Promise<string> {
  if (!tools.ffmpeg) throw new FfmpegNotFoundError("ffmpeg");
  await mkdir(dirname(outPath), { recursive: true });
  await runCapture(tools.ffmpeg, [
    "-y", "-hide_banner", "-ss", s3(atSec), "-i", src,
    "-frames:v", "1", "-vf", `scale=${width}:-2`, outPath,
  ], { timeoutMs: 30_000 });
  return outPath;
}

/** Contact sheet: a tiled grid of frames sampled across the clip. */
export async function generateContactSheet(
  tools: FfmpegTools,
  src: string,
  outPath: string,
  opts: { columns?: number; rows?: number; width?: number } = {},
): Promise<string> {
  if (!tools.ffmpeg) throw new FfmpegNotFoundError("ffmpeg");
  const columns = opts.columns ?? 5;
  const rows = opts.rows ?? 5;
  const width = opts.width ?? 240;
  await mkdir(dirname(outPath), { recursive: true });
  // Sample evenly: pick every Nth frame via thumbnail+tile.
  await runCapture(tools.ffmpeg, [
    "-y", "-hide_banner", "-i", src,
    "-vf", `select='not(mod(n\\,30))',scale=${width}:-2,tile=${columns}x${rows}`,
    "-frames:v", "1", outPath,
  ], { timeoutMs: 120_000 });
  return outPath;
}

export interface SceneChange {
  tick: Ticks;
  score: number;
}

/** Detect scene-change timestamps using the `select='gt(scene,threshold)'` filter. */
export async function detectScenes(
  tools: FfmpegTools,
  src: string,
  threshold = 0.3,
): Promise<SceneChange[]> {
  if (!tools.ffmpeg) throw new FfmpegNotFoundError("ffmpeg");
  const res = await runRaw(tools.ffmpeg, [
    "-hide_banner", "-i", src,
    "-filter_complex", `select='gt(scene,${threshold})',metadata=print`,
    "-an", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null",
  ], { timeoutMs: 300_000 });
  const scenes: SceneChange[] = [];
  const re = /pts_time:([\d.]+)[\s\S]*?scene_score=([\d.]+)/g;
  let m: RegExpExecArray | null;
  const text = res.stderr;
  while ((m = re.exec(text))) {
    scenes.push({ tick: secondsToTicks(Number(m[1])), score: Number(m[2]) });
  }
  return scenes;
}

/**
 * Extract downsampled waveform peaks (normalized 0..1, one per bucket) for timeline
 * display. Decodes a low-rate mono PCM stream and reduces it to peak-per-bucket in JS.
 */
export function extractWaveform(
  tools: FfmpegTools,
  src: string,
  buckets = 1000,
): Promise<number[]> {
  if (!tools.ffmpeg) return Promise.reject(new FfmpegNotFoundError("ffmpeg"));
  const sampleRate = 8000;
  return new Promise((resolve, reject) => {
    const child = spawn(
      tools.ffmpeg!,
      ["-hide_banner", "-v", "error", "-i", src, "-ac", "1", "-ar", String(sampleRate), "-f", "s16le", "-"],
      { windowsHide: true },
    );
    const parts: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => parts.push(d));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg waveform failed (${code}): ${stderr.slice(-500)}`));
      const buf = Buffer.concat(parts);
      const sampleCount = Math.floor(buf.length / 2);
      if (sampleCount === 0) return resolve([]);
      const perBucket = Math.max(1, Math.floor(sampleCount / buckets));
      const peaks: number[] = [];
      for (let b = 0; b < sampleCount; b += perBucket) {
        let peak = 0;
        for (let i = b; i < Math.min(b + perBucket, sampleCount); i++) {
          const v = Math.abs(buf.readInt16LE(i * 2));
          if (v > peak) peak = v;
        }
        peaks.push(peak / 32768);
      }
      resolve(peaks);
    });
  });
}

export async function extractKeyframes(
  tools: FfmpegTools,
  src: string,
  outDir: string,
  everySec = 2,
): Promise<string> {
  if (!tools.ffmpeg) throw new FfmpegNotFoundError("ffmpeg");
  await mkdir(outDir, { recursive: true });
  const pattern = join(outDir, "kf_%04d.jpg");
  await runCapture(tools.ffmpeg, [
    "-y", "-hide_banner", "-i", src,
    "-vf", `fps=1/${everySec},scale=480:-2`, pattern,
  ], { timeoutMs: 300_000 });
  return outDir;
}
