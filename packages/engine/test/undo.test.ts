import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditDocument } from "../src/document.js";
import type { Command } from "../src/commands.js";
import { deterministic, projectWithMedia, sec } from "./helpers.js";
import type { ProjectDoc } from "../src/schema.js";

let restore: () => void;
beforeEach(() => {
  restore = deterministic();
});
afterEach(() => restore());

/** Compare docs ignoring updatedAt (which the clock stamps). */
function eq(a: ProjectDoc, b: ProjectDoc): boolean {
  const strip = (d: ProjectDoc) => JSON.stringify({ ...d, updatedAt: "" });
  return strip(a) === strip(b);
}

describe("undo/redo round-trips", () => {
  it("every command is invertible and redoable across a mixed sequence", () => {
    const { doc, mediaId, videoTrackId } = projectWithMedia();

    // Build a non-trivial sequence of edits, snapshotting state before each apply.
    const clipId = doc.apply({
      type: "addClip",
      params: { trackId: videoTrackId, kind: "video", mediaId, startTick: 0, durationTick: sec(8) },
    }).created!.clipId!;

    const textTrack = doc.apply({ type: "addTrack", params: { kind: "text" } }).created!.trackId!;

    const sequence: Command[] = [
      { type: "trimClip", params: { clipId, edge: "end", toTick: sec(6) } },
      { type: "setClipSpeed", params: { clipId, speed: 2 } },
      { type: "setClipTransform", params: { clipId, patch: { scale: 1.3 } } },
      { type: "splitClip", params: { clipId, atTick: sec(1) } },
      { type: "renameProject", params: { name: "Renamed" } },
      {
        type: "addTextOverlay",
        params: {
          trackId: textTrack,
          startTick: 0,
          durationTick: sec(2),
          text: { text: "Hi", style: { fontFamily: "Inter", fontSize: 72, color: "#fff" }, anchor: { x: 0.5, y: 0.8 } },
        },
      },
      { type: "updateSettings", params: { patch: { fps: 60 } } },
    ];

    const snapshots: ProjectDoc[] = [structuredClone(doc.doc)];
    for (const cmd of sequence) {
      doc.apply(cmd);
      snapshots.push(structuredClone(doc.doc));
    }

    // Undo all the way back, verifying each prior snapshot is exactly reproduced.
    for (let i = sequence.length - 1; i >= 0; i--) {
      const r = doc.undo();
      expect(r).toBeDefined();
      expect(eq(doc.doc, snapshots[i]!)).toBe(true);
    }
    // Back at the pre-sequence state (setup commands remain on the undo stack).
    expect(eq(doc.doc, snapshots[0]!)).toBe(true);

    // Redo all the way forward, verifying each later snapshot is reproduced.
    for (let i = 0; i < sequence.length; i++) {
      const r = doc.redo();
      expect(r).toBeDefined();
      expect(eq(doc.doc, snapshots[i + 1]!)).toBe(true);
    }
    expect(doc.canRedo()).toBe(false);
  });

  it("applying a new command clears the redo stack", () => {
    const { doc, mediaId, videoTrackId } = projectWithMedia();
    doc.apply({
      type: "addClip",
      params: { trackId: videoTrackId, kind: "video", mediaId, startTick: 0, durationTick: sec(3) },
    });
    doc.undo();
    expect(doc.canRedo()).toBe(true);
    doc.apply({ type: "renameProject", params: { name: "New" } });
    expect(doc.canRedo()).toBe(false);
  });

  it("cascade media removal is fully invertible", () => {
    const { doc, mediaId, videoTrackId } = projectWithMedia();
    doc.apply({
      type: "addClip",
      params: { trackId: videoTrackId, kind: "video", mediaId, startTick: 0, durationTick: sec(3) },
    });
    const before = structuredClone(doc.doc);
    doc.apply({ type: "removeMedia", params: { mediaId, cascade: true } });
    expect(doc.doc.media).toHaveLength(0);
    expect(doc.doc.timeline.tracks.find((t) => t.id === videoTrackId)!.clips).toHaveLength(0);
    doc.undo();
    expect(eq(doc.doc, before)).toBe(true);
  });
});
