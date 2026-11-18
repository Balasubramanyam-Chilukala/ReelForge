import { describe, expect, it } from "vitest";
import { EditDocument, createProject, secondsToTicks, type MediaAsset } from "@reelforge/engine";
import { mapSourceSegmentToTimeline, buildCaptionUnits } from "../src/service.js";
import type { Transcript } from "@reelforge/media";

const sec = secondsToTicks;
const asset = (id: string): MediaAsset => ({
  id, kind: "video", path: `/m/${id}.mp4`, name: `${id}.mp4`, importedAt: "x",
  durationTicks: sec(20), width: 1920, height: 1080, fps: 30, hasAudio: true, probeStatus: "ready",
});

describe("mapSourceSegmentToTimeline", () => {
  it("maps source time to timeline through a trimmed clip", () => {
    const doc = new EditDocument(createProject({ fps: 30 }));
    const m = doc.apply({ type: "addMedia", params: { asset: asset("v") } }).created!.mediaId!;
    const vt = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
    // Clip starts at timeline 5s, source in-point 10s, 6s long.
    doc.apply({ type: "addClip", params: { trackId: vt, kind: "video", mediaId: m, startTick: sec(5), durationTick: sec(6), inTick: sec(10) } });

    // A transcript segment at source 12s–13s lands at timeline 5 + (12-10) = 7s.
    const r = mapSourceSegmentToTimeline(doc.doc, m, sec(12), sec(13));
    expect(r.startTick).toBe(sec(7));
    expect(r.endTick).toBe(sec(8));
  });

  it("accounts for clip speed", () => {
    const doc = new EditDocument(createProject({ fps: 30 }));
    const m = doc.apply({ type: "addMedia", params: { asset: asset("v") } }).created!.mediaId!;
    const vt = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
    // 2x speed: 8s of source => 4s timeline.
    doc.apply({ type: "addClip", params: { trackId: vt, kind: "video", mediaId: m, startTick: 0, durationTick: sec(4), inTick: 0, speed: 2 } });
    // source 2s at 2x => timeline 1s.
    const r = mapSourceSegmentToTimeline(doc.doc, m, sec(2), sec(2));
    expect(r.startTick).toBe(sec(1));
  });

  it("falls back to absolute timeline when media is not on the timeline", () => {
    const doc = new EditDocument(createProject({ fps: 30 }));
    const r = mapSourceSegmentToTimeline(doc.doc, "ghost", sec(3), sec(4));
    expect(r).toEqual({ startTick: sec(3), endTick: sec(4) });
  });
});

describe("buildCaptionUnits (word / group / phrase modes)", () => {
  const transcript: Transcript = {
    segments: [{ startTick: 0, endTick: sec(3), text: "hello there friend" }],
    words: [
      { startTick: 0, endTick: sec(1), text: "hello" },
      { startTick: sec(1), endTick: sec(2), text: "there" },
      { startTick: sec(2), endTick: sec(3), text: "friend" },
    ],
  };

  it("phrase mode = one unit per segment", () => {
    const u = buildCaptionUnits(transcript, "phrase", 3);
    expect(u).toHaveLength(1);
    expect(u[0]!.text).toBe("hello there friend");
  });

  it("word mode = one unit per word", () => {
    const u = buildCaptionUnits(transcript, "word", 3);
    expect(u.map((x) => x.text)).toEqual(["hello", "there", "friend"]);
    expect(u[1]!.startTick).toBe(sec(1));
  });

  it("group mode = N words per unit", () => {
    const u = buildCaptionUnits(transcript, "group", 2);
    expect(u).toHaveLength(2);
    expect(u[0]!.text).toBe("hello there");
    expect(u[0]!.endTick).toBe(sec(2));
    expect(u[1]!.text).toBe("friend");
  });

  it("derives words from segments when word timings are absent", () => {
    const noWords: Transcript = { segments: [{ startTick: 0, endTick: sec(4), text: "a b c d" }] };
    const u = buildCaptionUnits(noWords, "word", 1);
    expect(u).toHaveLength(4);
    expect(u[0]!.text).toBe("a");
    expect(u[3]!.startTick).toBe(sec(3)); // evenly split across 4s
  });
});
