/**
 * Media probing via ffprobe. Parses the JSON stream/format output into normalized
 * metadata using the engine's tick time model.
 */

import { secondsToTicks, type Ticks } from "@reelforge/engine";
import { FfmpegNotFoundError, runCapture, type FfmpegTools } from "./ffmpeg.js";

export interface ProbedMedia {
  kind: "video" | "image" | "audio";
  durationTicks?: Ticks;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio: boolean;
  codecVideo?: string;
  codecAudio?: string;
  sampleRate?: number;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  duration?: string;
  disposition?: Record<string, number>;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: { duration?: string; format_name?: string };
}

const IMAGE_FORMATS = /image2|png_pipe|mjpeg|jpeg|webp_pipe|gif|bmp/i;

function parseFrameRate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [n, d] = value.split("/").map(Number);
  if (!n || !d) return undefined;
  const fps = n / d;
  return Number.isFinite(fps) && fps > 0 ? fps : undefined;
}

export function parseProbeJson(json: FfprobeOutput): ProbedMedia {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const formatName = json.format?.format_name ?? "";

  const formatDuration = json.format?.duration ? Number(json.format.duration) : undefined;
  const streamDuration = video?.duration ? Number(video.duration) : undefined;
  const durationSec = formatDuration ?? streamDuration;

  const isImage =
    !!video && !audio && (IMAGE_FORMATS.test(formatName) || durationSec === undefined);

  let kind: ProbedMedia["kind"];
  if (isImage) kind = "image";
  else if (video) kind = "video";
  else kind = "audio";

  const result: ProbedMedia = {
    kind,
    hasAudio: !!audio,
    width: video?.width,
    height: video?.height,
    fps: parseFrameRate(video?.avg_frame_rate ?? video?.r_frame_rate),
    codecVideo: video?.codec_name,
    codecAudio: audio?.codec_name,
    sampleRate: audio?.sample_rate ? Number(audio.sample_rate) : undefined,
  };
  if (kind !== "image" && durationSec !== undefined && Number.isFinite(durationSec)) {
    result.durationTicks = secondsToTicks(durationSec);
  }
  return result;
}

export async function probeMedia(path: string, tools: FfmpegTools): Promise<ProbedMedia> {
  if (!tools.ffprobe) throw new FfmpegNotFoundError("ffprobe");
  const { stdout } = await runCapture(
    tools.ffprobe,
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ],
    { timeoutMs: 30_000 },
  );
  const json = JSON.parse(stdout) as FfprobeOutput;
  return parseProbeJson(json);
}
