/**
 * Export runner: compiles the timeline, invokes FFmpeg with progress parsing and
 * cancellation, then validates the output with FFprobe. Never reports success until a
 * valid file exists on disk with the expected streams.
 */

import { stat } from "node:fs/promises";
import { ticksToSeconds, type ProjectDoc } from "@reelforge/engine";
import { compileTimeline, type EncodeSettings } from "./filtergraph.js";
import { FfmpegNotFoundError, runRaw, type FfmpegTools } from "./ffmpeg.js";
import { parseProbeJson, probeMedia } from "./probe.js";

export interface ExportProgress {
  /** 0..1 fraction based on processed time vs total duration. */
  progress: number;
  timeSec: number;
  speed?: number;
  fps?: number;
}

export interface ExportOptions {
  outputPath: string;
  encode?: EncodeSettings;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
  /** If false (default), refuse to overwrite an existing file. */
  overwrite?: boolean;
  /** Normalize output loudness to ~ -14 LUFS for platform delivery. */
  normalizeLoudness?: boolean;
}

export interface ExportResult {
  outputPath: string;
  durationSec: number;
  width: number;
  height: number;
  fps?: number;
  hasAudio: boolean;
  sizeBytes: number;
  codecVideo?: string;
  codecAudio?: string;
}

/** Parse FFmpeg stderr progress lines (`time=00:00:03.45 speed=1.2x ...`). */
export function parseFfmpegTime(chunk: string): number | undefined {
  const m = chunk.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function exportTimeline(
  doc: ProjectDoc,
  tools: FfmpegTools,
  opts: ExportOptions,
): Promise<ExportResult> {
  if (!tools.ffmpeg) throw new FfmpegNotFoundError("ffmpeg");
  if (!opts.overwrite && (await fileExists(opts.outputPath))) {
    throw new Error(`refusing to overwrite existing file: ${opts.outputPath}`);
  }

  const compiled = compileTimeline(doc, { normalizeLoudness: opts.normalizeLoudness });
  const totalSec = compiled.durationSec;
  const args = compiled.toArgs(opts.outputPath, opts.encode);

  const res = await runRaw(tools.ffmpeg, args, {
    signal: opts.signal,
    onStderr: (chunk) => {
      const timeSec = parseFfmpegTime(chunk);
      if (timeSec !== undefined && opts.onProgress) {
        opts.onProgress({
          progress: totalSec > 0 ? Math.min(timeSec / totalSec, 1) : 0,
          timeSec,
          speed: Number(chunk.match(/speed=\s*([\d.]+)x/)?.[1]) || undefined,
          fps: Number(chunk.match(/fps=\s*([\d.]+)/)?.[1]) || undefined,
        });
      }
    },
  });

  if (res.code !== 0) {
    throw new Error(`FFmpeg export failed (code ${res.code}): ${res.stderr.slice(-2000)}`);
  }

  // Validate the real output with FFprobe — do not trust the exit code alone.
  if (!(await fileExists(opts.outputPath))) {
    throw new Error("FFmpeg reported success but no output file was produced");
  }
  const probed = await probeMedia(opts.outputPath, tools);
  if (!probed.width || !probed.height) {
    throw new Error("exported file has no valid video stream");
  }
  const { size } = await stat(opts.outputPath);
  return {
    outputPath: opts.outputPath,
    durationSec: probed.durationTicks ? ticksToSeconds(probed.durationTicks) : totalSec,
    width: probed.width,
    height: probed.height,
    fps: probed.fps,
    hasAudio: probed.hasAudio,
    sizeBytes: size,
    codecVideo: probed.codecVideo,
    codecAudio: probed.codecAudio,
  };
}

export { parseProbeJson };
