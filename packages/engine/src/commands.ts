/**
 * Editing commands. Every mutation to a project goes through one of these, which makes
 * the change invertible (undo/redo) and identical whether it originates from the UI or an
 * AI agent. Handlers are pure: (doc, params) -> { doc, inverse, created? }.
 *
 * Inverses are expressed as an internal `__restore` command carrying the previous value of
 * whatever slice changed (whole-slice snapshot: correctness over micro-optimization; the
 * affected arrays are small). Applying a `__restore` yields a `__restore` of the prior
 * state, giving symmetric undo/redo.
 */

import { now } from "./clock.js";
import { EngineError, invalid, notFound } from "./errors.js";
import { newId } from "./ids.js";
import {
  clipEnd,
  computeTimelineDuration,
  findClip,
  findMedia,
  findTrack,
  hasCollision,
  sortClips,
} from "./project.js";
import {
  DEFAULT_COLOR,
  DEFAULT_TRANSFORM,
  type Clip,
  type ClipKind,
  type ColorAdjust,
  type MediaAsset,
  type ProjectDoc,
  type ProjectSettings,
  type TextContent,
  type Track,
  type TrackKind,
  type Transform,
  type Transition,
  type TransitionKind,
} from "./schema.js";
import type { Ticks } from "./time.js";

// ---- Command types ----

export interface Command<P = unknown> {
  type: string;
  params: P;
}

export interface CommandExec {
  doc: ProjectDoc;
  inverse: Command;
  /** Ids created by the command (e.g. { clipId }), surfaced to callers/agents. */
  created?: Record<string, string>;
}

interface RestoreParams {
  name?: string;
  settings?: ProjectSettings;
  media?: MediaAsset[];
  tracks?: Track[];
  updatedAt?: string;
}

// ---- Internal helpers ----

function stamp<T extends ProjectDoc>(doc: T): T {
  return { ...doc, updatedAt: now() };
}

function timelineWith(tracks: Track[]): { tracks: Track[]; durationTicks: Ticks } {
  return { tracks, durationTicks: computeTimelineDuration({ tracks, durationTicks: 0 }) };
}

/** Build a result that replaces the tracks array; inverse snapshots the previous tracks. */
function tracksResult(
  doc: ProjectDoc,
  nextTracks: Track[],
  created?: Record<string, string>,
): CommandExec {
  const inverse: Command<RestoreParams> = {
    type: "__restore",
    params: { tracks: doc.timeline.tracks, updatedAt: doc.updatedAt },
  };
  const next = stamp({ ...doc, timeline: timelineWith(nextTracks) });
  return { doc: next, inverse, created };
}

function mediaResult(doc: ProjectDoc, nextMedia: MediaAsset[]): CommandExec {
  const inverse: Command<RestoreParams> = {
    type: "__restore",
    params: { media: doc.media, updatedAt: doc.updatedAt },
  };
  return { doc: stamp({ ...doc, media: nextMedia }), inverse };
}

/** Replace a single track by id within the tracks array (immutably). */
function replaceTrack(tracks: Track[], trackId: string, next: Track): Track[] {
  return tracks.map((t) => (t.id === trackId ? next : t));
}

/** Immutably update one clip within a track's clip list, keeping sort order. */
function withUpdatedClip(track: Track, clipId: string, update: (c: Clip) => Clip): Track {
  const clips = track.clips.map((c) => (c.id === clipId ? update(c) : c));
  return { ...track, clips: sortClips(clips) };
}

// ---- Restore (internal, invertible core) ----

function applyRestore(doc: ProjectDoc, params: RestoreParams): CommandExec {
  const invParams: RestoreParams = { updatedAt: doc.updatedAt };
  let next: ProjectDoc = { ...doc };
  if (params.name !== undefined) {
    invParams.name = doc.name;
    next.name = params.name;
  }
  if (params.settings) {
    invParams.settings = doc.settings;
    next.settings = params.settings;
  }
  if (params.media) {
    invParams.media = doc.media;
    next.media = params.media;
  }
  if (params.tracks) {
    invParams.tracks = doc.timeline.tracks;
    next.timeline = timelineWith(params.tracks);
  }
  next.updatedAt = params.updatedAt ?? doc.updatedAt;
  return { doc: next, inverse: { type: "__restore", params: invParams } };
}

// ---- Project-level commands ----

export interface RenameProjectParams {
  name: string;
}
function renameProject(doc: ProjectDoc, p: RenameProjectParams): CommandExec {
  if (!p.name.trim()) throw invalid("project name must not be empty");
  const inverse: Command<RestoreParams> = {
    type: "__restore",
    params: { name: doc.name, updatedAt: doc.updatedAt },
  };
  return { doc: stamp({ ...doc, name: p.name }), inverse };
}

export interface UpdateSettingsParams {
  patch: Partial<ProjectSettings>;
}
function updateSettings(doc: ProjectDoc, p: UpdateSettingsParams): CommandExec {
  if (p.patch.width !== undefined && p.patch.width <= 0) throw invalid("width must be > 0");
  if (p.patch.height !== undefined && p.patch.height <= 0)
    throw invalid("height must be > 0");
  if (p.patch.fps !== undefined && !(p.patch.fps > 0)) throw invalid("fps must be > 0");
  const inverse: Command<RestoreParams> = {
    type: "__restore",
    params: { settings: doc.settings, updatedAt: doc.updatedAt },
  };
  return { doc: stamp({ ...doc, settings: { ...doc.settings, ...p.patch } }), inverse };
}

// ---- Media commands ----

export interface AddMediaParams {
  /** Asset to add. If `id` is omitted an id is generated and returned in `created`. */
  asset: Omit<MediaAsset, "id" | "importedAt"> & { id?: string; importedAt?: string };
}
function addMedia(doc: ProjectDoc, p: AddMediaParams): CommandExec {
  const id = p.asset.id ?? newId("med");
  if (doc.media.some((m) => m.id === id)) throw invalid(`media id already exists: ${id}`);
  const asset: MediaAsset = {
    ...p.asset,
    id,
    importedAt: p.asset.importedAt ?? now(),
  };
  const res = mediaResult(doc, [...doc.media, asset]);
  res.created = { mediaId: id };
  return res;
}

export interface RemoveMediaParams {
  mediaId: string;
  /** If true, also remove clips referencing the media. Otherwise error if referenced. */
  cascade?: boolean;
}
function removeMedia(doc: ProjectDoc, p: RemoveMediaParams): CommandExec {
  if (!findMedia(doc, p.mediaId)) throw notFound("media", p.mediaId);
  const referencing = doc.timeline.tracks.flatMap((t) =>
    t.clips.filter((c) => c.mediaId === p.mediaId),
  );
  if (referencing.length > 0 && !p.cascade) {
    throw new EngineError(
      "STATE",
      `media ${p.mediaId} is used by ${referencing.length} clip(s); pass cascade to remove`,
      { clipCount: referencing.length },
    );
  }
  const nextMedia = doc.media.filter((m) => m.id !== p.mediaId);
  if (referencing.length === 0) return mediaResult(doc, nextMedia);
  // Cascade: inverse must restore both media and tracks.
  const nextTracks = doc.timeline.tracks.map((t) => ({
    ...t,
    clips: t.clips.filter((c) => c.mediaId !== p.mediaId),
  }));
  const inverse: Command<RestoreParams> = {
    type: "__restore",
    params: { media: doc.media, tracks: doc.timeline.tracks, updatedAt: doc.updatedAt },
  };
  const next = stamp({ ...doc, media: nextMedia, timeline: timelineWith(nextTracks) });
  return { doc: next, inverse };
}

// ---- Track commands ----

export interface AddTrackParams {
  kind: TrackKind;
  name?: string;
  /** Insert position in the stack; appended if omitted. */
  index?: number;
}
function addTrack(doc: ProjectDoc, p: AddTrackParams): CommandExec {
  const id = newId("trk");
  const kindCount = doc.timeline.tracks.filter((t) => t.kind === p.kind).length + 1;
  const name = p.name ?? `${capitalize(p.kind)} ${kindCount}`;
  const track: Track = { id, kind: p.kind, name, index: doc.timeline.tracks.length, clips: [] };
  let next = [...doc.timeline.tracks, track];
  if (p.index !== undefined) {
    next = [...doc.timeline.tracks];
    next.splice(Math.max(0, Math.min(p.index, next.length)), 0, track);
  }
  next = reindexTracks(next);
  const res = tracksResult(doc, next);
  res.created = { trackId: id };
  return res;
}

export interface RemoveTrackParams {
  trackId: string;
}
function removeTrack(doc: ProjectDoc, p: RemoveTrackParams): CommandExec {
  if (!findTrack(doc, p.trackId)) throw notFound("track", p.trackId);
  const next = reindexTracks(doc.timeline.tracks.filter((t) => t.id !== p.trackId));
  return tracksResult(doc, next);
}

export interface RenameTrackParams {
  trackId: string;
  name: string;
}
function renameTrack(doc: ProjectDoc, p: RenameTrackParams): CommandExec {
  const track = findTrack(doc, p.trackId);
  if (!track) throw notFound("track", p.trackId);
  const next = replaceTrack(doc.timeline.tracks, p.trackId, { ...track, name: p.name });
  return tracksResult(doc, next);
}

export interface SetTrackFlagsParams {
  trackId: string;
  muted?: boolean;
  locked?: boolean;
}
function setTrackFlags(doc: ProjectDoc, p: SetTrackFlagsParams): CommandExec {
  const track = findTrack(doc, p.trackId);
  if (!track) throw notFound("track", p.trackId);
  const nextTrack: Track = { ...track };
  if (p.muted !== undefined) nextTrack.muted = p.muted;
  if (p.locked !== undefined) nextTrack.locked = p.locked;
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, p.trackId, nextTrack));
}

// ---- Clip commands ----

export interface SetTrackDuckParams {
  /** The track that should duck (e.g. music). */
  trackId: string;
  /** The track it ducks under (e.g. voice/dialogue). Pass null to clear ducking. */
  underTrackId: string | null;
  ratio?: number;
  threshold?: number;
}
function setTrackDuck(doc: ProjectDoc, p: SetTrackDuckParams): CommandExec {
  const track = findTrack(doc, p.trackId);
  if (!track) throw notFound("track", p.trackId);
  let nextTrack: Track;
  if (p.underTrackId === null) {
    const { duck, ...rest } = track;
    void duck;
    nextTrack = { ...rest };
  } else {
    if (!findTrack(doc, p.underTrackId)) throw notFound("track", p.underTrackId);
    if (p.underTrackId === p.trackId) throw invalid("a track cannot duck under itself");
    nextTrack = {
      ...track,
      duck: { underTrackId: p.underTrackId, ratio: p.ratio ?? 8, threshold: p.threshold ?? 0.03 },
    };
  }
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, p.trackId, nextTrack));
}

export interface AddClipParams {
  trackId: string;
  kind: ClipKind;
  mediaId?: string;
  /** Timeline start. If omitted, appended after the last clip on the track. */
  startTick?: Ticks;
  durationTick: Ticks;
  inTick?: Ticks;
  speed?: number;
  label?: string;
  /** Allow overlap (default false → throws COLLISION). */
  allowOverlap?: boolean;
}
function addClip(doc: ProjectDoc, p: AddClipParams): CommandExec {
  const track = findTrack(doc, p.trackId);
  if (!track) throw notFound("track", p.trackId);
  if (p.durationTick <= 0) throw invalid("durationTick must be > 0");
  if (p.mediaId && !findMedia(doc, p.mediaId)) throw notFound("media", p.mediaId);
  if ((p.kind === "video" || p.kind === "image" || p.kind === "audio") && !p.mediaId) {
    throw invalid(`clip kind '${p.kind}' requires a mediaId`);
  }
  const start =
    p.startTick ?? (track.clips.length ? Math.max(...track.clips.map(clipEnd)) : 0);
  if (start < 0) throw invalid("startTick must be >= 0");
  if (!p.allowOverlap && hasCollision(track, start, p.durationTick)) {
    throw new EngineError("COLLISION", "clip overlaps an existing clip on the track", {
      trackId: p.trackId,
      startTick: start,
    });
  }
  const id = newId("clp");
  const clip: Clip = {
    id,
    kind: p.kind,
    mediaId: p.mediaId,
    startTick: start,
    durationTick: p.durationTick,
    inTick: p.inTick ?? 0,
    speed: p.speed ?? 1,
    label: p.label,
  };
  validateSourceBounds(doc, clip);
  const nextTrack = { ...track, clips: sortClips([...track.clips, clip]) };
  const res = tracksResult(doc, replaceTrack(doc.timeline.tracks, p.trackId, nextTrack));
  res.created = { clipId: id };
  return res;
}

export interface RemoveClipParams {
  clipId: string;
}
function removeClip(doc: ProjectDoc, p: RemoveClipParams): CommandExec {
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const nextTrack = {
    ...loc.track,
    clips: loc.track.clips.filter((c) => c.id !== p.clipId),
  };
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

export interface TrimClipParams {
  clipId: string;
  /** Which edge to move. */
  edge: "start" | "end";
  /** New timeline tick for that edge. */
  toTick: Ticks;
}
function trimClip(doc: ProjectDoc, p: TrimClipParams): CommandExec {
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const clip = loc.clip;
  const end = clipEnd(clip);
  let next: Clip;
  if (p.edge === "start") {
    if (p.toTick >= end) throw invalid("trimmed start must be before clip end");
    if (p.toTick < 0) throw invalid("start must be >= 0");
    const delta = p.toTick - clip.startTick; // + trims later, - extends earlier
    // Shift source in-point by the same source-span the timeline moved (× speed).
    const inTick = clip.inTick + Math.round(delta * clip.speed);
    if (inTick < 0) throw new EngineError("OUT_OF_BOUNDS", "trim exceeds media head");
    next = {
      ...clip,
      startTick: p.toTick,
      durationTick: end - p.toTick,
      inTick,
    };
  } else {
    if (p.toTick <= clip.startTick) throw invalid("trimmed end must be after clip start");
    next = { ...clip, durationTick: p.toTick - clip.startTick };
  }
  validateSourceBounds(doc, next);
  if (hasCollision(loc.track, next.startTick, next.durationTick, clip.id)) {
    throw new EngineError("COLLISION", "trim would overlap an adjacent clip");
  }
  const nextTrack = withUpdatedClip(loc.track, clip.id, () => next);
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

export interface SplitClipParams {
  clipId: string;
  /** Absolute timeline tick to split at (must be strictly inside the clip). */
  atTick: Ticks;
}
function splitClip(doc: ProjectDoc, p: SplitClipParams): CommandExec {
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const clip = loc.clip;
  if (p.atTick <= clip.startTick || p.atTick >= clipEnd(clip)) {
    throw invalid("split point must be strictly inside the clip");
  }
  const leftDuration = p.atTick - clip.startTick;
  const left: Clip = { ...clip, durationTick: leftDuration };
  const right: Clip = {
    ...clip,
    id: newId("clp"),
    startTick: p.atTick,
    durationTick: clipEnd(clip) - p.atTick,
    inTick: clip.inTick + Math.round(leftDuration * clip.speed),
    // Transition-in belongs to the first half only.
    transitionIn: undefined,
    fades: clip.fades ? { inTicks: clip.fades.inTicks, outTicks: 0 } : undefined,
  };
  const clips = loc.track.clips.flatMap((c) => (c.id === clip.id ? [left, right] : [c]));
  const nextTrack = { ...loc.track, clips: sortClips(clips) };
  const res = tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
  res.created = { leftId: left.id, rightId: right.id };
  return res;
}

export interface MoveClipParams {
  clipId: string;
  startTick?: Ticks;
  toTrackId?: string;
  allowOverlap?: boolean;
}
function moveClip(doc: ProjectDoc, p: MoveClipParams): CommandExec {
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const destTrack = p.toTrackId ? findTrack(doc, p.toTrackId) : loc.track;
  if (!destTrack) throw notFound("track", p.toTrackId!);
  const start = p.startTick ?? loc.clip.startTick;
  if (start < 0) throw invalid("startTick must be >= 0");
  const moved: Clip = { ...loc.clip, startTick: start };
  if (
    !p.allowOverlap &&
    hasCollision(destTrack, start, moved.durationTick, moved.id)
  ) {
    throw new EngineError("COLLISION", "move would overlap a clip on the destination track");
  }
  let tracks = doc.timeline.tracks;
  if (destTrack.id === loc.track.id) {
    tracks = replaceTrack(tracks, loc.track.id, {
      ...loc.track,
      clips: sortClips(loc.track.clips.map((c) => (c.id === moved.id ? moved : c))),
    });
  } else {
    tracks = replaceTrack(tracks, loc.track.id, {
      ...loc.track,
      clips: loc.track.clips.filter((c) => c.id !== moved.id),
    });
    const freshDest = tracks.find((t) => t.id === destTrack.id)!;
    tracks = replaceTrack(tracks, destTrack.id, {
      ...freshDest,
      clips: sortClips([...freshDest.clips, moved]),
    });
  }
  return tracksResult(doc, tracks);
}

export interface ReorderClipsParams {
  trackId: string;
  /** Clip ids in the desired order; laid end-to-end from the track's first start. */
  clipIds: string[];
  /** Gap in ticks to leave between clips (default 0). */
  gapTicks?: Ticks;
}
function reorderClips(doc: ProjectDoc, p: ReorderClipsParams): CommandExec {
  const track = findTrack(doc, p.trackId);
  if (!track) throw notFound("track", p.trackId);
  const byId = new Map(track.clips.map((c) => [c.id, c]));
  if (p.clipIds.length !== track.clips.length) {
    throw invalid("clipIds must list every clip on the track exactly once");
  }
  for (const id of p.clipIds) if (!byId.has(id)) throw notFound("clip", id);
  const gap = p.gapTicks ?? 0;
  let cursor = Math.min(...track.clips.map((c) => c.startTick));
  const reordered: Clip[] = p.clipIds.map((id) => {
    const c = byId.get(id)!;
    const placed = { ...c, startTick: cursor };
    cursor += c.durationTick + gap;
    return placed;
  });
  const nextTrack = { ...track, clips: reordered };
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, p.trackId, nextTrack));
}

export interface SetClipSpeedParams {
  clipId: string;
  speed: number;
}
function setClipSpeed(doc: ProjectDoc, p: SetClipSpeedParams): CommandExec {
  if (!(p.speed > 0)) throw invalid("speed must be > 0");
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const clip = loc.clip;
  // Source span consumed stays constant; timeline duration scales inversely with speed.
  const sourceSpan = clip.durationTick * clip.speed;
  const nextDuration = Math.max(1, Math.round(sourceSpan / p.speed));
  const next: Clip = { ...clip, speed: p.speed, durationTick: nextDuration };
  if (hasCollision(loc.track, next.startTick, next.durationTick, clip.id)) {
    throw new EngineError("COLLISION", "new speed makes the clip overlap its neighbour");
  }
  const nextTrack = withUpdatedClip(loc.track, clip.id, () => next);
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

export interface SetClipFitParams {
  clipId: string;
  fit: "contain" | "cover";
}
function setClipFit(doc: ProjectDoc, p: SetClipFitParams): CommandExec {
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const nextTrack = withUpdatedClip(loc.track, p.clipId, (c) => ({ ...c, fit: p.fit }));
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

export interface SetClipTransformParams {
  clipId: string;
  patch: Partial<Transform>;
}
function setClipTransform(doc: ProjectDoc, p: SetClipTransformParams): CommandExec {
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const base = loc.clip.transform ?? DEFAULT_TRANSFORM;
  const transform: Transform = { ...base, ...p.patch };
  const nextTrack = withUpdatedClip(loc.track, p.clipId, (c) => ({ ...c, transform }));
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

export interface SetClipColorParams {
  clipId: string;
  patch: Partial<ColorAdjust>;
}
function setClipColor(doc: ProjectDoc, p: SetClipColorParams): CommandExec {
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const base = loc.clip.color ?? DEFAULT_COLOR;
  const color: ColorAdjust = { ...base, ...p.patch };
  const nextTrack = withUpdatedClip(loc.track, p.clipId, (c) => ({ ...c, color }));
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

export interface SetClipVolumeParams {
  clipId: string;
  volume: number;
}
function setClipVolume(doc: ProjectDoc, p: SetClipVolumeParams): CommandExec {
  if (p.volume < 0) throw invalid("volume must be >= 0");
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const nextTrack = withUpdatedClip(loc.track, p.clipId, (c) => ({ ...c, volume: p.volume }));
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

export interface SetClipFadesParams {
  clipId: string;
  inTicks?: Ticks;
  outTicks?: Ticks;
}
function setClipFades(doc: ProjectDoc, p: SetClipFadesParams): CommandExec {
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const base = loc.clip.fades ?? { inTicks: 0, outTicks: 0 };
  const fades = {
    inTicks: Math.max(0, p.inTicks ?? base.inTicks),
    outTicks: Math.max(0, p.outTicks ?? base.outTicks),
  };
  if (fades.inTicks + fades.outTicks > loc.clip.durationTick) {
    throw invalid("fades exceed clip duration");
  }
  const nextTrack = withUpdatedClip(loc.track, p.clipId, (c) => ({ ...c, fades }));
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

export interface AddTransitionParams {
  clipId: string;
  kind: TransitionKind;
  durationTicks: Ticks;
}
function addTransition(doc: ProjectDoc, p: AddTransitionParams): CommandExec {
  if (p.durationTicks <= 0) throw invalid("transition duration must be > 0");
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  if (p.durationTicks >= loc.clip.durationTick) {
    throw invalid("transition must be shorter than the clip");
  }
  const transition: Transition = { kind: p.kind, durationTicks: p.durationTicks };
  const nextTrack = withUpdatedClip(loc.track, p.clipId, (c) => ({
    ...c,
    transitionIn: transition,
  }));
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

export interface AddTextOverlayParams {
  trackId: string;
  startTick: Ticks;
  durationTick: Ticks;
  text: TextContent;
  allowOverlap?: boolean;
}
function addTextOverlay(doc: ProjectDoc, p: AddTextOverlayParams): CommandExec {
  const track = findTrack(doc, p.trackId);
  if (!track) throw notFound("track", p.trackId);
  if (track.kind !== "text" && track.kind !== "overlay") {
    throw invalid("text overlays must go on a text or overlay track");
  }
  if (p.durationTick <= 0) throw invalid("durationTick must be > 0");
  if (!p.allowOverlap && hasCollision(track, p.startTick, p.durationTick)) {
    throw new EngineError("COLLISION", "text overlay overlaps an existing clip");
  }
  const id = newId("clp");
  const clip: Clip = {
    id,
    kind: "text",
    startTick: p.startTick,
    durationTick: p.durationTick,
    inTick: 0,
    speed: 1,
    text: p.text,
  };
  const nextTrack = { ...track, clips: sortClips([...track.clips, clip]) };
  const res = tracksResult(doc, replaceTrack(doc.timeline.tracks, p.trackId, nextTrack));
  res.created = { clipId: id };
  return res;
}

export interface EditTextParams {
  clipId: string;
  text?: string;
  stylePatch?: Partial<TextContent["style"]>;
  anchor?: { x: number; y: number };
  animation?: string;
}
function editText(doc: ProjectDoc, p: EditTextParams): CommandExec {
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  if (!loc.clip.text) throw invalid("clip has no text content");
  const prev = loc.clip.text;
  const text: TextContent = {
    text: p.text ?? prev.text,
    style: { ...prev.style, ...p.stylePatch },
    anchor: p.anchor ?? prev.anchor,
    animation: p.animation ?? prev.animation,
  };
  const nextTrack = withUpdatedClip(loc.track, p.clipId, (c) => ({ ...c, text }));
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

export interface ApplyEffectParams {
  clipId: string;
  name: string;
  params?: Record<string, number | string | boolean>;
}
function applyEffect(doc: ProjectDoc, p: ApplyEffectParams): CommandExec {
  const loc = findClip(doc, p.clipId);
  if (!loc) throw notFound("clip", p.clipId);
  const effects = [...(loc.clip.effects ?? [])];
  const existing = effects.findIndex((e) => e.name === p.name);
  const entry = { name: p.name, params: p.params ?? {} };
  if (existing >= 0) effects[existing] = entry;
  else effects.push(entry);
  const nextTrack = withUpdatedClip(loc.track, p.clipId, (c) => ({ ...c, effects }));
  return tracksResult(doc, replaceTrack(doc.timeline.tracks, loc.track.id, nextTrack));
}

// ---- Validation helpers ----

function validateSourceBounds(doc: ProjectDoc, clip: Clip): void {
  if (!clip.mediaId) return;
  const media = findMedia(doc, clip.mediaId);
  if (!media) throw notFound("media", clip.mediaId);
  if (clip.kind === "image") return; // stills have no temporal source bound
  if (media.durationTicks === undefined) return; // not yet probed; skip bound check
  const sourceSpan = Math.round(clip.durationTick * clip.speed);
  if (clip.inTick < 0 || clip.inTick + sourceSpan > media.durationTicks + 1) {
    throw new EngineError("OUT_OF_BOUNDS", "clip extends beyond media source duration", {
      inTick: clip.inTick,
      sourceSpan,
      mediaDuration: media.durationTicks,
    });
  }
}

function reindexTracks(tracks: Track[]): Track[] {
  return tracks.map((t, i) => (t.index === i ? t : { ...t, index: i }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---- Dispatch ----

type Handler = (doc: ProjectDoc, params: any) => CommandExec;

const HANDLERS: Record<string, Handler> = {
  __restore: (doc, params) => applyRestore(doc, params as RestoreParams),
  renameProject,
  updateSettings,
  addMedia,
  removeMedia,
  addTrack,
  removeTrack,
  renameTrack,
  setTrackFlags,
  setTrackDuck,
  addClip,
  removeClip,
  trimClip,
  splitClip,
  moveClip,
  reorderClips,
  setClipSpeed,
  setClipFit,
  setClipTransform,
  setClipColor,
  setClipVolume,
  setClipFades,
  addTransition,
  addTextOverlay,
  editText,
  applyEffect,
};

/** The set of command types that modify project state (all of them, excluding reads). */
export const MUTATING_COMMANDS = Object.keys(HANDLERS).filter((t) => t !== "__restore");

export function execute(doc: ProjectDoc, cmd: Command): CommandExec {
  const handler = HANDLERS[cmd.type];
  if (!handler) throw invalid(`unknown command: ${cmd.type}`);
  return handler(doc, cmd.params);
}

export function isKnownCommand(type: string): boolean {
  return type in HANDLERS;
}
