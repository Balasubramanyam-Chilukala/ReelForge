/**
 * End-to-end export test. Requires FFmpeg; auto-skips with a clear message when absent so
 * the suite stays green on machines without FFmpeg (e.g. this dev box). CI installs FFmpeg
 * so this runs there. Uses programmatically generated color-bar + tone assets.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EditDocument,
  createProject,
  secondsToTicks,
  type MediaAsset,
} from "@reelforge/engine";
import { detectFfmpeg, type FfmpegTools } from "../src/ffmpeg.js";
import { probeMedia } from "../src/probe.js";
import { exportTimeline } from "../src/export.js";
import { hasFfmpeg, makeTestVideo } from "./assets.js";

const sec = secondsToTicks;
let present = false;
let tools: FfmpegTools;
let dir: string;

beforeAll(async () => {
  present = await hasFfmpeg();
  tools = await detectFfmpeg();
  if (present) dir = await mkdtemp(join(tmpdir(), "reelforge-e2e-"));
});
afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("export pipeline", () => {
  it("exports a trimmed 2-clip reel and validates it with ffprobe", async () => {
    if (!present) {
      console.warn("[skip] FFmpeg not found — export e2e skipped. Install FFmpeg to run it.");
      return;
    }
    // Generate two short source clips.
    const a = join(dir, "a.mp4");
    const b = join(dir, "b.mp4");
    await makeTestVideo(a, { seconds: 3, width: 640, height: 360, withAudio: true });
    await makeTestVideo(b, { seconds: 3, width: 640, height: 360, withAudio: true });

    const metaA = await probeMedia(a, tools);
    const metaB = await probeMedia(b, tools);

    const doc = new EditDocument(createProject({ aspect: "9:16", fps: 30 }));
    const assetA: MediaAsset = { id: "a", kind: "video", path: a, name: "a.mp4", importedAt: "x", durationTicks: metaA.durationTicks, width: metaA.width, height: metaA.height, fps: metaA.fps, hasAudio: metaA.hasAudio, probeStatus: "ready" };
    const assetB: MediaAsset = { ...assetA, id: "b", path: b, name: "b.mp4", durationTicks: metaB.durationTicks };
    doc.apply({ type: "addMedia", params: { asset: assetA } });
    doc.apply({ type: "addMedia", params: { asset: assetB } });
    const vtrack = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
    doc.apply({ type: "addClip", params: { trackId: vtrack, kind: "video", mediaId: "a", startTick: 0, durationTick: sec(2) } });
    doc.apply({ type: "addClip", params: { trackId: vtrack, kind: "video", mediaId: "b", startTick: sec(2), durationTick: sec(2) } });

    const out = join(dir, "reel.mp4");
    const result = await exportTimeline(doc.doc, tools, { outputPath: out, encode: { preset: "ultrafast", crf: 28 } });

    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.hasAudio).toBe(true);
    expect(result.durationSec).toBeGreaterThan(3.5);
    expect(result.durationSec).toBeLessThan(4.5);
    expect(result.sizeBytes).toBeGreaterThan(0);
    expect(result.codecVideo).toBe("h264");
  }, 180_000);

  it("renders a real cross-dissolve transition + audio ducking (valid FFmpeg graph)", async () => {
    if (!present) return;
    const a = join(dir, "t1.mp4");
    const b = join(dir, "t2.mp4");
    await makeTestVideo(a, { seconds: 2, width: 320, height: 240, withAudio: true });
    await makeTestVideo(b, { seconds: 2, width: 320, height: 240, withAudio: true });
    const ma = await probeMedia(a, tools);
    const mb = await probeMedia(b, tools);

    const doc = new EditDocument(createProject({ aspect: "9:16", fps: 30 }));
    const assetA: MediaAsset = { id: "ta", kind: "video", path: a, name: "t1.mp4", importedAt: "x", durationTicks: ma.durationTicks, width: ma.width, height: ma.height, fps: ma.fps, hasAudio: ma.hasAudio, probeStatus: "ready" };
    const assetB: MediaAsset = { ...assetA, id: "tb", path: b, name: "t2.mp4", durationTicks: mb.durationTicks };
    doc.apply({ type: "addMedia", params: { asset: assetA } });
    doc.apply({ type: "addMedia", params: { asset: assetB } });
    const vt = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
    doc.apply({ type: "addClip", params: { trackId: vt, kind: "video", mediaId: "ta", startTick: 0, durationTick: sec(2) } });
    const c2 = doc.apply({ type: "addClip", params: { trackId: vt, kind: "video", mediaId: "tb", startTick: sec(2), durationTick: sec(2) } }).created!.clipId!;
    doc.apply({ type: "addTransition", params: { clipId: c2, kind: "crossDissolve", durationTicks: sec(1) } });

    // Two audio tracks with ducking (music under the video's audio acting as "voice").
    const music = doc.apply({ type: "addTrack", params: { kind: "audio", name: "Music" } }).created!.trackId!;
    doc.apply({ type: "addClip", params: { trackId: music, kind: "audio", mediaId: "ta", startTick: 0, durationTick: sec(2) } });
    const videoTrackId = vt;
    doc.apply({ type: "setTrackDuck", params: { trackId: music, underTrackId: videoTrackId, ratio: 8 } });

    const out = join(dir, "transition.mp4");
    const result = await exportTimeline(doc.doc, tools, { outputPath: out, encode: { preset: "ultrafast", crf: 30 } });
    expect(result.width).toBe(1080);
    expect(result.hasAudio).toBe(true);
    expect(result.codecVideo).toBe("h264");
  }, 180_000);

  it("renders named visual effects (vignette + sharpen + warm) to a valid file", async () => {
    if (!present) return;
    const a = join(dir, "fx.mp4");
    await makeTestVideo(a, { seconds: 2, width: 320, height: 240, withAudio: false });
    const ma = await probeMedia(a, tools);
    const doc = new EditDocument(createProject({ aspect: "1:1", fps: 30 }));
    doc.apply({ type: "addMedia", params: { asset: { id: "fx", kind: "video", path: a, name: "fx.mp4", importedAt: "x", durationTicks: ma.durationTicks, width: ma.width, height: ma.height, fps: ma.fps, hasAudio: false, probeStatus: "ready" } } });
    const vt = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
    const clip = doc.apply({ type: "addClip", params: { trackId: vt, kind: "video", mediaId: "fx", startTick: 0, durationTick: sec(2) } }).created!.clipId!;
    doc.apply({ type: "applyEffect", params: { clipId: clip, name: "vignette", params: { amount: 0.5 } } });
    doc.apply({ type: "applyEffect", params: { clipId: clip, name: "sharpen", params: { amount: 0.7 } } });
    doc.apply({ type: "applyEffect", params: { clipId: clip, name: "warm", params: { amount: 0.2 } } });
    doc.apply({ type: "setClipColor", params: { clipId: clip, patch: { saturation: 0.2, contrast: 0.1 } } });
    const out = join(dir, "fx-out.mp4");
    const result = await exportTimeline(doc.doc, tools, { outputPath: out, encode: { preset: "ultrafast", crf: 30 } });
    expect(result.width).toBe(1080);
    expect(result.codecVideo).toBe("h264");
  }, 120_000);

  it("refuses to overwrite an existing export without the overwrite flag", async () => {
    if (!present) return;
    const out = join(dir, "exists.mp4");
    await makeTestVideo(out, { seconds: 1, withAudio: false });
    const doc = new EditDocument(createProject());
    await expect(exportTimeline(doc.doc, tools, { outputPath: out })).rejects.toThrow(/refusing to overwrite/);
  }, 60_000);
});
