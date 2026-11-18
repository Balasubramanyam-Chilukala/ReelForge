/**
 * Project construction and timeline helper functions (pure).
 */

import { newId } from "./ids.js";
import {
  CURRENT_SCHEMA_VERSION,
  RESOLUTION_PRESETS,
  type AspectPreset,
  type Clip,
  type ProjectDoc,
  type ProjectSettings,
  type Timeline,
  type Track,
  type TrackKind,
} from "./schema.js";
import type { Ticks } from "./time.js";

export interface CreateProjectOptions {
  name?: string;
  aspect?: AspectPreset;
  fps?: number;
  sampleRate?: number;
  background?: string;
  now?: () => string;
}

const nowIso = () => new Date().toISOString();

export function createDefaultSettings(
  aspect: AspectPreset = "9:16",
  fps = 30,
  sampleRate = 48_000,
  background = "#000000",
): ProjectSettings {
  const res = RESOLUTION_PRESETS[aspect];
  return {
    width: res.width,
    height: res.height,
    aspect: res.aspect,
    fps,
    sampleRate,
    background,
  };
}

/** Build the default empty track set: one video, one audio. */
export function createDefaultTracks(): Track[] {
  return [
    { id: newId("trk"), kind: "video", name: "Video 1", index: 0, clips: [] },
    { id: newId("trk"), kind: "audio", name: "Audio 1", index: 1, clips: [] },
  ];
}

export function createProject(opts: CreateProjectOptions = {}): ProjectDoc {
  const now = opts.now ?? nowIso;
  const ts = now();
  const settings = createDefaultSettings(
    opts.aspect ?? "9:16",
    opts.fps ?? 30,
    opts.sampleRate ?? 48_000,
    opts.background ?? "#000000",
  );
  const timeline: Timeline = { tracks: createDefaultTracks(), durationTicks: 0 };
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId("prj"),
    name: opts.name ?? "Untitled Project",
    createdAt: ts,
    updatedAt: ts,
    settings,
    media: [],
    timeline,
  };
}

// ---- Timeline helpers (pure, non-mutating unless noted) ----

export function clipEnd(clip: Clip): Ticks {
  return clip.startTick + clip.durationTick;
}

/** Sort a clip array ascending by startTick (returns a new array). */
export function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.startTick - b.startTick || a.id.localeCompare(b.id));
}

export function findTrack(doc: ProjectDoc, trackId: string): Track | undefined {
  return doc.timeline.tracks.find((t) => t.id === trackId);
}

export interface ClipLocation {
  track: Track;
  clip: Clip;
  clipIndex: number;
}

export function findClip(doc: ProjectDoc, clipId: string): ClipLocation | undefined {
  for (const track of doc.timeline.tracks) {
    const clipIndex = track.clips.findIndex((c) => c.id === clipId);
    if (clipIndex >= 0) {
      return { track, clip: track.clips[clipIndex]!, clipIndex };
    }
  }
  return undefined;
}

export function findMedia(doc: ProjectDoc, mediaId: string) {
  return doc.media.find((m) => m.id === mediaId);
}

/** True if [startA,endA) overlaps [startB,endB). Touching edges do not overlap. */
export function rangesOverlap(
  startA: Ticks,
  endA: Ticks,
  startB: Ticks,
  endB: Ticks,
): boolean {
  return startA < endB && startB < endA;
}

/** Does placing a clip of [start, start+duration) collide with others on the track? */
export function hasCollision(
  track: Track,
  start: Ticks,
  duration: Ticks,
  ignoreClipId?: string,
): boolean {
  const end = start + duration;
  return track.clips.some(
    (c) =>
      c.id !== ignoreClipId && rangesOverlap(start, end, c.startTick, clipEnd(c)),
  );
}

/** Recompute the cached timeline duration from all clips across all tracks. */
export function computeTimelineDuration(timeline: Timeline): Ticks {
  let max = 0;
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      const end = clipEnd(clip);
      if (end > max) max = end;
    }
  }
  return max;
}
