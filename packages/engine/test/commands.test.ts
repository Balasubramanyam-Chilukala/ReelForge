import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditDocument } from "../src/document.js";
import { createProject } from "../src/project.js";
import { clipEnd, findClip } from "../src/project.js";
import { EngineError } from "../src/errors.js";
import { deterministic, projectWithMedia, sec, videoAsset } from "./helpers.js";

let restore: () => void;
beforeEach(() => {
  restore = deterministic();
});
afterEach(() => restore());

describe("media + clip basics", () => {
  it("adds media and returns a created id", () => {
    const doc = new EditDocument(createProject());
    const r = doc.apply({ type: "addMedia", params: { asset: videoAsset("v1") } });
    expect(r.created?.mediaId).toBeTruthy();
    expect(doc.doc.media).toHaveLength(1);
  });

  it("adds a clip and updates timeline duration", () => {
    const { doc, mediaId, videoTrackId } = projectWithMedia();
    const r = doc.apply({
      type: "addClip",
      params: { trackId: videoTrackId, kind: "video", mediaId, startTick: 0, durationTick: sec(5) },
    });
    expect(r.created?.clipId).toBeTruthy();
    expect(doc.doc.timeline.durationTicks).toBe(sec(5));
  });

  it("appends a clip after the last when startTick omitted", () => {
    const { doc, mediaId, videoTrackId } = projectWithMedia();
    doc.apply({
      type: "addClip",
      params: { trackId: videoTrackId, kind: "video", mediaId, startTick: 0, durationTick: sec(3) },
    });
    doc.apply({
      type: "addClip",
      params: { trackId: videoTrackId, kind: "video", mediaId, durationTick: sec(2) },
    });
    const clips = doc.doc.timeline.tracks.find((t) => t.id === videoTrackId)!.clips;
    expect(clips).toHaveLength(2);
    expect(clips[1]!.startTick).toBe(sec(3));
  });

  it("rejects overlapping clips by default", () => {
    const { doc, mediaId, videoTrackId } = projectWithMedia();
    doc.apply({
      type: "addClip",
      params: { trackId: videoTrackId, kind: "video", mediaId, startTick: 0, durationTick: sec(5) },
    });
    expect(() =>
      doc.apply({
        type: "addClip",
        params: { trackId: videoTrackId, kind: "video", mediaId, startTick: sec(2), durationTick: sec(2) },
      }),
    ).toThrowError(EngineError);
  });

  it("rejects clips extending past media duration", () => {
    const { doc, mediaId, videoTrackId } = projectWithMedia(); // media is 10s
    expect(() =>
      doc.apply({
        type: "addClip",
        params: { trackId: videoTrackId, kind: "video", mediaId, startTick: 0, durationTick: sec(12) },
      }),
    ).toThrowError(/beyond media source/);
  });
});

describe("trim / split / speed", () => {
  function withClip() {
    const ctx = projectWithMedia();
    const r = ctx.doc.apply({
      type: "addClip",
      params: { trackId: ctx.videoTrackId, kind: "video", mediaId: ctx.mediaId, startTick: 0, durationTick: sec(8) },
    });
    return { ...ctx, clipId: r.created!.clipId! };
  }

  it("trims the end", () => {
    const { doc, clipId } = withClip();
    doc.apply({ type: "trimClip", params: { clipId, edge: "end", toTick: sec(5) } });
    expect(findClip(doc.doc, clipId)!.clip.durationTick).toBe(sec(5));
  });

  it("trims the start and shifts the source in-point", () => {
    const { doc, clipId } = withClip();
    doc.apply({ type: "trimClip", params: { clipId, edge: "start", toTick: sec(2) } });
    const clip = findClip(doc.doc, clipId)!.clip;
    expect(clip.startTick).toBe(sec(2));
    expect(clip.durationTick).toBe(sec(6));
    expect(clip.inTick).toBe(sec(2));
  });

  it("splits a clip into two contiguous clips", () => {
    const { doc, clipId } = withClip();
    const r = doc.apply({ type: "splitClip", params: { clipId, atTick: sec(3) } });
    const left = findClip(doc.doc, r.created!.leftId!)!.clip;
    const right = findClip(doc.doc, r.created!.rightId!)!.clip;
    expect(left.durationTick).toBe(sec(3));
    expect(right.startTick).toBe(sec(3));
    expect(right.durationTick).toBe(sec(5));
    expect(right.inTick).toBe(sec(3));
    expect(clipEnd(right)).toBe(sec(8));
  });

  it("sets clip fit (reframe cover/contain)", () => {
    const { doc, clipId } = withClip();
    doc.apply({ type: "setClipFit", params: { clipId, fit: "cover" } });
    expect(findClip(doc.doc, clipId)!.clip.fit).toBe("cover");
    doc.apply({ type: "setClipFit", params: { clipId, fit: "contain" } });
    expect(findClip(doc.doc, clipId)!.clip.fit).toBe("contain");
  });

  it("changes speed and scales timeline duration inversely", () => {
    const { doc, clipId } = withClip(); // 8s on timeline, speed 1
    doc.apply({ type: "setClipSpeed", params: { clipId, speed: 2 } });
    const clip = findClip(doc.doc, clipId)!.clip;
    expect(clip.speed).toBe(2);
    expect(clip.durationTick).toBe(sec(4)); // same 8s of source at 2x = 4s timeline
  });

  it("rejects an out-of-range split", () => {
    const { doc, clipId } = withClip();
    expect(() => doc.apply({ type: "splitClip", params: { clipId, atTick: sec(99) } })).toThrow();
  });
});

describe("move / reorder", () => {
  it("moves a clip to another track", () => {
    const { doc, mediaId, videoTrackId } = projectWithMedia();
    const t2 = doc.apply({ type: "addTrack", params: { kind: "video" } }).created!.trackId!;
    const clipId = doc.apply({
      type: "addClip",
      params: { trackId: videoTrackId, kind: "video", mediaId, startTick: 0, durationTick: sec(3) },
    }).created!.clipId!;
    doc.apply({ type: "moveClip", params: { clipId, toTrackId: t2, startTick: sec(1) } });
    expect(findClip(doc.doc, clipId)!.track.id).toBe(t2);
    expect(findClip(doc.doc, clipId)!.clip.startTick).toBe(sec(1));
  });

  it("reorders clips end-to-end in a given order", () => {
    const { doc, mediaId, videoTrackId } = projectWithMedia();
    const a = doc.apply({
      type: "addClip",
      params: { trackId: videoTrackId, kind: "video", mediaId, startTick: 0, durationTick: sec(2) },
    }).created!.clipId!;
    const b = doc.apply({
      type: "addClip",
      params: { trackId: videoTrackId, kind: "video", mediaId, startTick: sec(2), durationTick: sec(3) },
    }).created!.clipId!;
    doc.apply({ type: "reorderClips", params: { trackId: videoTrackId, clipIds: [b, a] } });
    const clips = doc.doc.timeline.tracks.find((t) => t.id === videoTrackId)!.clips;
    expect(clips.map((c) => c.id)).toEqual([b, a]);
    expect(clips[0]!.startTick).toBe(0);
    expect(clips[0]!.durationTick).toBe(sec(3));
    expect(clips[1]!.startTick).toBe(sec(3));
  });
});

describe("transitions, transform, fades, effects", () => {
  function withClip() {
    const ctx = projectWithMedia();
    const clipId = ctx.doc.apply({
      type: "addClip",
      params: { trackId: ctx.videoTrackId, kind: "video", mediaId: ctx.mediaId, startTick: 0, durationTick: sec(8) },
    }).created!.clipId!;
    return { ...ctx, clipId };
  }

  it("adds a transition shorter than the clip", () => {
    const { doc, clipId } = withClip();
    doc.apply({ type: "addTransition", params: { clipId, kind: "crossDissolve", durationTicks: sec(1) } });
    expect(findClip(doc.doc, clipId)!.clip.transitionIn?.kind).toBe("crossDissolve");
  });

  it("rejects a transition longer than the clip", () => {
    const { doc, clipId } = withClip();
    expect(() =>
      doc.apply({ type: "addTransition", params: { clipId, kind: "zoom", durationTicks: sec(99) } }),
    ).toThrow();
  });

  it("merges transform patches onto defaults", () => {
    const { doc, clipId } = withClip();
    doc.apply({ type: "setClipTransform", params: { clipId, patch: { scale: 1.2 } } });
    doc.apply({ type: "setClipTransform", params: { clipId, patch: { rotation: 90 } } });
    const t = findClip(doc.doc, clipId)!.clip.transform!;
    expect(t.scale).toBe(1.2);
    expect(t.rotation).toBe(90);
    expect(t.opacity).toBe(1);
  });

  it("rejects fades longer than the clip", () => {
    const { doc, clipId } = withClip();
    expect(() =>
      doc.apply({ type: "setClipFades", params: { clipId, inTicks: sec(5), outTicks: sec(5) } }),
    ).toThrow();
  });

  it("applies and replaces a named effect", () => {
    const { doc, clipId } = withClip();
    doc.apply({ type: "applyEffect", params: { clipId, name: "vignette", params: { amount: 0.3 } } });
    doc.apply({ type: "applyEffect", params: { clipId, name: "vignette", params: { amount: 0.6 } } });
    const effects = findClip(doc.doc, clipId)!.clip.effects!;
    expect(effects).toHaveLength(1);
    expect(effects[0]!.params.amount).toBe(0.6);
  });
});

describe("audio ducking (setTrackDuck)", () => {
  it("marks a track to duck under another and clears it", () => {
    const { doc } = projectWithMedia();
    const music = doc.apply({ type: "addTrack", params: { kind: "audio", name: "Music" } }).created!.trackId!;
    const voice = doc.apply({ type: "addTrack", params: { kind: "audio", name: "Voice" } }).created!.trackId!;
    doc.apply({ type: "setTrackDuck", params: { trackId: music, underTrackId: voice, ratio: 10 } });
    const t = doc.doc.timeline.tracks.find((x) => x.id === music)!;
    expect(t.duck).toEqual({ underTrackId: voice, ratio: 10, threshold: 0.03 });
    doc.apply({ type: "setTrackDuck", params: { trackId: music, underTrackId: null } });
    expect(doc.doc.timeline.tracks.find((x) => x.id === music)!.duck).toBeUndefined();
  });

  it("rejects ducking under a missing track and under itself", () => {
    const { doc } = projectWithMedia();
    const music = doc.apply({ type: "addTrack", params: { kind: "audio" } }).created!.trackId!;
    expect(() => doc.apply({ type: "setTrackDuck", params: { trackId: music, underTrackId: "nope" } })).toThrow();
    expect(() => doc.apply({ type: "setTrackDuck", params: { trackId: music, underTrackId: music } })).toThrow();
  });
});

describe("text overlays", () => {
  it("adds a text overlay on a text track", () => {
    const { doc } = projectWithMedia();
    const textTrack = doc.apply({ type: "addTrack", params: { kind: "text" } }).created!.trackId!;
    const r = doc.apply({
      type: "addTextOverlay",
      params: {
        trackId: textTrack,
        startTick: 0,
        durationTick: sec(2),
        text: { text: "Hello", style: { fontFamily: "Inter", fontSize: 72, color: "#fff" }, anchor: { x: 0.5, y: 0.8 } },
      },
    });
    expect(r.created?.clipId).toBeTruthy();
    doc.apply({ type: "editText", params: { clipId: r.created!.clipId!, text: "World" } });
    expect(findClip(doc.doc, r.created!.clipId!)!.clip.text!.text).toBe("World");
  });

  it("rejects text overlays on a video track", () => {
    const { doc, videoTrackId } = projectWithMedia();
    expect(() =>
      doc.apply({
        type: "addTextOverlay",
        params: {
          trackId: videoTrackId,
          startTick: 0,
          durationTick: sec(2),
          text: { text: "x", style: { fontFamily: "Inter", fontSize: 72, color: "#fff" }, anchor: { x: 0.5, y: 0.5 } },
        },
      }),
    ).toThrow();
  });
});
