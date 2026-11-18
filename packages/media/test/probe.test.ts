import { describe, expect, it } from "vitest";
import { ticksToSeconds } from "@reelforge/engine";
import { parseProbeJson } from "../src/probe.js";

describe("parseProbeJson", () => {
  it("parses a video with audio", () => {
    const r = parseProbeJson({
      format: { duration: "12.5", format_name: "mov,mp4,m4a" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30/1" },
        { codec_type: "audio", codec_name: "aac", sample_rate: "48000" },
      ],
    });
    expect(r.kind).toBe("video");
    expect(r.hasAudio).toBe(true);
    expect(r.width).toBe(1920);
    expect(r.fps).toBe(30);
    expect(ticksToSeconds(r.durationTicks!)).toBeCloseTo(12.5, 3);
  });

  it("detects a still image (no duration, image format)", () => {
    const r = parseProbeJson({
      format: { format_name: "png_pipe" },
      streams: [{ codec_type: "video", codec_name: "png", width: 800, height: 600 }],
    });
    expect(r.kind).toBe("image");
    expect(r.hasAudio).toBe(false);
    expect(r.durationTicks).toBeUndefined();
  });

  it("parses an audio-only file", () => {
    const r = parseProbeJson({
      format: { duration: "30", format_name: "mp3" },
      streams: [{ codec_type: "audio", codec_name: "mp3", sample_rate: "44100" }],
    });
    expect(r.kind).toBe("audio");
    expect(r.sampleRate).toBe(44100);
  });

  it("parses fractional (29.97) frame rate", () => {
    const r = parseProbeJson({
      format: { duration: "5", format_name: "mp4" },
      streams: [{ codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30000/1001" }],
    });
    expect(r.fps).toBeCloseTo(29.97, 2);
  });
});
