/**
 * ReelForge project document model (versioned).
 *
 * This is the authoritative, serializable shape of a project. Everything the editor and
 * the AI agents manipulate lives here. The schema is versioned; see migrations.ts.
 */

import type { Fps, Ticks } from "./time.js";

export const CURRENT_SCHEMA_VERSION = 1 as const;

export type TrackKind = "video" | "audio" | "text" | "overlay";
export type ClipKind = "video" | "image" | "audio" | "text" | "shape";
export type MediaKind = "video" | "image" | "audio";

export interface ProjectSettings {
  /** Canvas width in pixels (export/preview reference frame). */
  width: number;
  /** Canvas height in pixels. */
  height: number;
  /** Project frame rate. */
  fps: Fps;
  /** Audio sample rate for mixing/export. */
  sampleRate: number;
  /** Aspect ratio label, informational (e.g. "9:16"). */
  aspect: string;
  /** Background color behind all tracks, hex. */
  background: string;
}

export interface MediaAsset {
  id: string;
  kind: MediaKind;
  /** Absolute or project-relative path to the source file. */
  path: string;
  name: string;
  importedAt: string;
  /** Natural duration of the source in ticks (video/audio); undefined for stills. */
  durationTicks?: Ticks;
  width?: number;
  height?: number;
  fps?: Fps;
  hasAudio?: boolean;
  /** Probe/analysis status so the UI can show progress without blocking import. */
  probeStatus?: "pending" | "ready" | "error";
  probeError?: string;
}

export interface Transform {
  /** Center offset from canvas center, in pixels. */
  x: number;
  y: number;
  /** Uniform scale factor (1 = fit). */
  scale: number;
  /** Rotation in degrees. */
  rotation: number;
  /** 0..1. */
  opacity: number;
  /** Optional crop in normalized 0..1 insets {l,t,r,b}. */
  crop?: { l: number; t: number; r: number; b: number };
}

export interface ColorAdjust {
  brightness: number; // -1..1
  contrast: number; // -1..1
  saturation: number; // -1..1
  temperature: number; // -1..1
}

export interface Fades {
  /** Fade-in duration in ticks (visual and/or audio depending on clip kind). */
  inTicks: Ticks;
  outTicks: Ticks;
}

export type TransitionKind =
  | "crossDissolve"
  | "fadeToBlack"
  | "fadeFromBlack"
  | "zoom"
  | "slide"
  | "wipe"
  | "blur";

export interface Transition {
  kind: TransitionKind;
  /** Duration of the transition in ticks, overlapping into the previous clip. */
  durationTicks: Ticks;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  outlineColor?: string;
  outlineWidth?: number;
  shadow?: boolean;
  background?: string;
  highlightColor?: string;
  /** Named caption preset used, if any (see captions module). */
  preset?: string;
}

export interface TextContent {
  text: string;
  style: TextStyle;
  /** Normalized position on canvas, 0..1 for both axes (0.5 = center). */
  anchor: { x: number; y: number };
  /** Animation preset name for entrance/emphasis. */
  animation?: string;
}

export interface Clip {
  id: string;
  kind: ClipKind;
  /** Media asset this clip references (absent for text/shape clips). */
  mediaId?: string;
  /** Position on the timeline where the clip starts, in ticks. */
  startTick: Ticks;
  /** Length of the clip on the timeline, in ticks (after speed). */
  durationTick: Ticks;
  /** Source in-point within the media, in ticks (media clips only). */
  inTick: Ticks;
  /** Playback speed multiplier (1 = normal). >1 faster, <1 slower. */
  speed: number;
  /** How the source fills the canvas: "contain" (fit, letterbox) or "cover" (fill, crop). */
  fit?: "contain" | "cover";
  transform?: Transform;
  color?: ColorAdjust;
  /** Audio gain multiplier (1 = unity). */
  volume?: number;
  fades?: Fades;
  /** Transition applied at the clip's incoming edge (overlaps previous clip). */
  transitionIn?: Transition;
  /** Effects applied to the clip (name + params); kept generic for extensibility. */
  effects?: { name: string; params: Record<string, number | string | boolean> }[];
  /** Text payload for text clips. */
  text?: TextContent;
  /** Freeform label for UI/agents. */
  label?: string;
}

export interface TrackDuck {
  /** Id of the track (usually voice) this track ducks UNDER. */
  underTrackId: string;
  /** Gain reduction ratio applied while the sidechain is loud (e.g. 8). */
  ratio: number;
  /** Threshold 0..1 above which ducking engages. */
  threshold: number;
}

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  /** Stacking/ordering index; lower = lower in the stack (rendered first). */
  index: number;
  muted?: boolean;
  locked?: boolean;
  /** When set, this track's audio is sidechain-compressed under another track (ducking). */
  duck?: TrackDuck;
  /** Clips sorted ascending by startTick (invariant maintained by operations). */
  clips: Clip[];
}

export interface Timeline {
  tracks: Track[];
  /** Cached total duration in ticks (max clip end across tracks). */
  durationTicks: Ticks;
}

export interface ProjectDoc {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: ProjectSettings;
  media: MediaAsset[];
  timeline: Timeline;
}

/** Common aspect/resolution presets used by the UI and export panel. */
export const RESOLUTION_PRESETS = {
  "9:16": { width: 1080, height: 1920, aspect: "9:16" },
  "16:9": { width: 1920, height: 1080, aspect: "16:9" },
  "1:1": { width: 1080, height: 1080, aspect: "1:1" },
  "4:5": { width: 1080, height: 1350, aspect: "4:5" },
} as const;

export type AspectPreset = keyof typeof RESOLUTION_PRESETS;

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

export const DEFAULT_COLOR: ColorAdjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
};
