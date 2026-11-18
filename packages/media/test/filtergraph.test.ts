import { describe, expect, it } from "vitest";
import {
  EditDocument,
  createProject,
  secondsToTicks,
  type MediaAsset,
} from "@reelforge/engine";
import { atempoChain, compileTimeline, effectToFilter, escapeDrawtext } from "../src/filtergraph.js";

const sec = secondsToTicks;

function videoAsset(id: string, seconds = 10): MediaAsset {
  return {
    id, kind: "video", path: `/m/${id}.mp4`, name: `${id}.mp4`,
    importedAt: "2026-01-01T00:00:00.000Z", durationTicks: sec(seconds),
    width: 1920, height: 1080, fps: 30, hasAudio: true, probeStatus: "ready",
  };
}

function buildTwoClipProject() {
  const doc = new EditDocument(createProject({ aspect: "9:16", fps: 30 }));
  const m1 = doc.apply({ type: "addMedia", params: { asset: videoAsset("a") } }).created!.mediaId!;
  const m2 = doc.apply({ type: "addMedia", params: { asset: videoAsset("b") } }).created!.mediaId!;
  const vtrack = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
  doc.apply({ type: "addClip", params: { trackId: vtrack, kind: "video", mediaId: m1, startTick: 0, durationTick: sec(3) } });
  doc.apply({ type: "addClip", params: { trackId: vtrack, kind: "video", mediaId: m2, startTick: sec(3), durationTick: sec(2) } });
  return doc;
}

describe("compileTimeline", () => {
  it("produces a canvas + overlays + mapped outputs for a 2-clip project", () => {
    const compiled = compileTimeline(buildTwoClipProject().doc);
    expect(compiled.inputs).toHaveLength(4); // 2 video inputs + 2 audio inputs
    expect(compiled.filterComplex).toContain("color=c=0x000000:s=1080x1920");
    expect(compiled.filterComplex).toContain("overlay=");
    expect(compiled.filterComplex).toContain("[vout]");
    expect(compiled.audioLabel).toBe("aout");
    expect(compiled.durationSec).toBeCloseTo(5, 3);
  });

  it("builds a valid ffmpeg argument vector", () => {
    const compiled = compileTimeline(buildTwoClipProject().doc);
    const args = compiled.toArgs("out.mp4", { crf: 18, preset: "fast" });
    expect(args[0]).toBe("-y");
    expect(args).toContain("-filter_complex");
    expect(args).toContain("libx264");
    expect(args).toContain("-crf");
    expect(args[args.indexOf("-crf") + 1]).toBe("18");
    expect(args).toContain("+faststart");
    expect(args[args.length - 1]).toBe("out.mp4");
    // One -i per input.
    expect(args.filter((a) => a === "-i")).toHaveLength(4);
  });

  it("uses input seeking with trim for a mid-clip in-point", () => {
    const doc = new EditDocument(createProject({ fps: 30 }));
    const m = doc.apply({ type: "addMedia", params: { asset: videoAsset("a") } }).created!.mediaId!;
    const vtrack = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
    const clip = doc.apply({ type: "addClip", params: { trackId: vtrack, kind: "video", mediaId: m, startTick: 0, durationTick: sec(4) } }).created!.clipId!;
    doc.apply({ type: "trimClip", params: { clipId: clip, edge: "start", toTick: sec(1) } });
    const compiled = compileTimeline(doc.doc);
    // in-point shifted to 1s, duration 3s
    const vInput = compiled.inputs[0]!;
    expect(vInput.pre).toEqual(["-ss", "1.000", "-t", "3.000"]);
  });

  it("emits drawtext for a text overlay with escaped content", () => {
    const doc = new EditDocument(createProject({ fps: 30 }));
    const tt = doc.apply({ type: "addTrack", params: { kind: "text" } }).created!.trackId!;
    doc.apply({
      type: "addTextOverlay",
      params: {
        trackId: tt, startTick: sec(1), durationTick: sec(2),
        text: { text: "Hello: world", style: { fontFamily: "Inter", fontSize: 64, color: "#ffffff", shadow: true }, anchor: { x: 0.5, y: 0.85 } },
      },
    });
    const compiled = compileTimeline(doc.doc);
    expect(compiled.filterComplex).toContain("drawtext=");
    expect(compiled.filterComplex).toContain("Hello\\: world");
    expect(compiled.filterComplex).toContain("between(t,1.000,3.000)");
  });

  it("image clips loop instead of seeking", () => {
    const doc = new EditDocument(createProject({ fps: 30 }));
    const img: MediaAsset = { id: "i", kind: "image", path: "/m/i.png", name: "i.png", importedAt: "x", width: 1000, height: 1000, hasAudio: false, probeStatus: "ready" };
    doc.apply({ type: "addMedia", params: { asset: img } });
    const ot = doc.apply({ type: "addTrack", params: { kind: "overlay" } }).created!.trackId!;
    doc.apply({ type: "addClip", params: { trackId: ot, kind: "image", mediaId: "i", startTick: 0, durationTick: sec(2) } });
    const compiled = compileTimeline(doc.doc);
    expect(compiled.inputs[0]!.pre).toEqual(["-loop", "1", "-t", "2.000"]);
  });
});

describe("transitions", () => {
  function twoClips(transition?: { kind: string; durationTicks: number }) {
    const doc = new EditDocument(createProject({ aspect: "9:16", fps: 30 }));
    const m = doc.apply({ type: "addMedia", params: { asset: videoAsset("a") } }).created!.mediaId!;
    const vtrack = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
    doc.apply({ type: "addClip", params: { trackId: vtrack, kind: "video", mediaId: m, startTick: 0, durationTick: sec(3) } });
    const c2 = doc.apply({ type: "addClip", params: { trackId: vtrack, kind: "video", mediaId: m, startTick: sec(3), durationTick: sec(3) } }).created!.clipId!;
    if (transition) doc.apply({ type: "addTransition", params: { clipId: c2, kind: transition.kind, durationTicks: transition.durationTicks } });
    return doc;
  }

  it("crossDissolve renders a real alpha cross-fade with overlap (no fade-to-black)", () => {
    const g = compileTimeline(twoClips({ kind: "crossDissolve", durationTicks: sec(1) }).doc);
    // second clip overlaps: renders starting at 2.000s (3 - 1) and alpha-fades in.
    expect(g.filterComplex).toContain("format=yuva420p");
    expect(g.filterComplex).toContain("fade=t=in:st=0:d=1.000:alpha=1");
    expect(g.filterComplex).toContain("between(t,2.000,6.000)");
  });

  it("slide animates overlay X during the transition window", () => {
    const g = compileTimeline(twoClips({ kind: "slide", durationTicks: sec(1) }).doc);
    expect(g.filterComplex).toContain("W*max(0");
  });

  it("fadeFromBlack uses a luma fade, not alpha", () => {
    const g = compileTimeline(twoClips({ kind: "fadeFromBlack", durationTicks: sec(1) }).doc);
    expect(g.filterComplex).toContain("fade=t=in:st=0:d=1.000");
    expect(g.filterComplex).not.toContain("alpha=1");
  });
});

describe("audio ducking", () => {
  it("emits sidechaincompress when a music track ducks under a voice track", () => {
    const doc = new EditDocument(createProject({ fps: 30 }));
    const m = doc.apply({ type: "addMedia", params: { asset: videoAsset("music") } }).created!.mediaId!;
    const v = doc.apply({ type: "addMedia", params: { asset: videoAsset("voice") } }).created!.mediaId!;
    const music = doc.apply({ type: "addTrack", params: { kind: "audio", name: "Music" } }).created!.trackId!;
    const voice = doc.apply({ type: "addTrack", params: { kind: "audio", name: "Voice" } }).created!.trackId!;
    doc.apply({ type: "addClip", params: { trackId: music, kind: "audio", mediaId: m, startTick: 0, durationTick: sec(5) } });
    doc.apply({ type: "addClip", params: { trackId: voice, kind: "audio", mediaId: v, startTick: 0, durationTick: sec(5) } });
    doc.apply({ type: "setTrackDuck", params: { trackId: music, underTrackId: voice, ratio: 8 } });
    const g = compileTimeline(doc.doc);
    expect(g.filterComplex).toContain("asplit=2");
    expect(g.filterComplex).toContain("sidechaincompress=threshold=0.03:ratio=8");
  });
});

describe("atempoChain", () => {
  it("returns a single factor within range", () => {
    expect(atempoChain(1.5)).toEqual([1.5]);
  });
  it("chains factors for speeds above 2x", () => {
    expect(atempoChain(4)).toEqual([2, 2]);
  });
  it("chains factors for speeds below 0.5x", () => {
    expect(atempoChain(0.25)).toEqual([0.5, 0.5]);
  });
});

describe("reframe (fit) and loudness", () => {
  function clipDoc(fit?: "cover" | "contain") {
    const doc = new EditDocument(createProject({ aspect: "9:16", fps: 30 }));
    const m = doc.apply({ type: "addMedia", params: { asset: videoAsset("a") } }).created!.mediaId!;
    const vt = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
    const c = doc.apply({ type: "addClip", params: { trackId: vt, kind: "video", mediaId: m, startTick: 0, durationTick: sec(3) } }).created!.clipId!;
    if (fit) doc.apply({ type: "setClipFit", params: { clipId: c, fit } });
    return doc;
  }

  it("cover fit scales up and crops (fills the frame, no bars)", () => {
    const g = compileTimeline(clipDoc("cover").doc);
    expect(g.filterComplex).toContain("force_original_aspect_ratio=increase");
    expect(g.filterComplex).toContain("crop=1080:1920");
  });

  it("contain fit (default) letterboxes with decrease", () => {
    const g = compileTimeline(clipDoc().doc);
    expect(g.filterComplex).toContain("force_original_aspect_ratio=decrease");
    expect(g.filterComplex).not.toContain("crop=1080:1920");
  });

  it("normalizeLoudness adds a loudnorm stage to the audio mix", () => {
    const g = compileTimeline(clipDoc().doc, { normalizeLoudness: true });
    expect(g.filterComplex).toContain("loudnorm=I=-14");
  });
});

describe("named visual effects", () => {
  it("maps effect names to real ffmpeg filters", () => {
    expect(effectToFilter("vignette", { amount: 0.5 })).toMatch(/^vignette=angle=/);
    expect(effectToFilter("blur", { amount: 0.5 })).toMatch(/^gblur=sigma=/);
    expect(effectToFilter("sharpen", {})).toMatch(/^unsharp=/);
    expect(effectToFilter("grayscale", {})).toBe("hue=s=0");
    expect(effectToFilter("invert", {})).toBe("negate");
    expect(effectToFilter("nonsense", {})).toBeNull();
  });

  it("renders applied effects into the clip's filter chain", () => {
    const doc = new EditDocument(createProject({ fps: 30 }));
    const m = doc.apply({ type: "addMedia", params: { asset: videoAsset("a") } }).created!.mediaId!;
    const vt = doc.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
    const clip = doc.apply({ type: "addClip", params: { trackId: vt, kind: "video", mediaId: m, startTick: 0, durationTick: sec(3) } }).created!.clipId!;
    doc.apply({ type: "applyEffect", params: { clipId: clip, name: "vignette", params: { amount: 0.6 } } });
    doc.apply({ type: "applyEffect", params: { clipId: clip, name: "blur", params: { amount: 0.4 } } });
    const g = compileTimeline(doc.doc);
    expect(g.filterComplex).toContain("vignette=angle=");
    expect(g.filterComplex).toContain("gblur=sigma=");
  });
});

describe("escapeDrawtext", () => {
  it("escapes colons and percent", () => {
    expect(escapeDrawtext("a: 50%")).toBe("a\\: 50\\%");
  });
});
