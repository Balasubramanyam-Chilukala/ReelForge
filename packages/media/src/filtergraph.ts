/**
 * Timeline -> FFmpeg compiler.
 *
 * Model: everything is composited onto a generated canvas (color source) sized to the
 * project. Each visual clip is scaled/positioned and overlaid at its timeline position via
 * `overlay=...:enable='between(t,start,end)'`; text clips are drawn with `drawtext`. Audio
 * clips are trimmed (by input seeking), gained, faded, delayed to position, and mixed.
 *
 * This uniform "overlay on a canvas" approach handles multiple tracks, gaps, and arbitrary
 * positioning without special-casing concatenation.
 *
 * Supported in v1: trim, per-clip scale/fit, position offset, rotation, opacity (static),
 * speed (video via setpts, audio via atempo), fade in/out (to black / silence), color eq,
 * text overlays, multi-track audio mix.
 * Documented limitations (Phase 7): true alpha cross-dissolve/xfade transitions (currently
 * approximated by fade-to-black), advanced blend effects, GPU encode selection.
 */

import { ticksToSeconds, type Clip, type ProjectDoc, type Track } from "@reelforge/engine";

export interface EncodeSettings {
  /** Constant Rate Factor for x264 (lower = higher quality). Ignored if bitrate set. */
  crf?: number;
  /** Target video bitrate, e.g. "8M". Overrides crf when present. */
  videoBitrate?: string;
  audioBitrate?: string;
  preset?: "ultrafast" | "veryfast" | "fast" | "medium" | "slow";
  /** Override output fps; defaults to project fps. */
  fps?: number;
}

export interface FfmpegInput {
  /** Options placed before -i (e.g. -ss, -t, -loop). */
  pre: string[];
  path: string;
}

export interface CompiledExport {
  inputs: FfmpegInput[];
  filterComplex: string;
  videoLabel: string;
  audioLabel: string | null;
  /** Total output duration in seconds. */
  durationSec: number;
  /** Build the full ffmpeg argument vector for a given output path. */
  toArgs(outputPath: string, encode?: EncodeSettings): string[];
  /** Build args to render a single composited frame at `atSec` to an image file. */
  toFrameArgs(outputPath: string, atSec: number): string[];
}

const s3 = (sec: number) => sec.toFixed(3);

/** Transition kinds rendered as a real alpha cross-dissolve (with optional motion). */
const DISSOLVE_KINDS = new Set<string>(["crossDissolve", "zoom", "slide", "wipe", "blur"]);

function hexToFfColor(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length === 6) return `0x${h}`;
  return hex;
}

/** Escape text for use inside a drawtext `text=` value. */
export function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’") // curly apostrophe avoids quoting hell
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

interface VisualItem {
  clip: Clip;
  track: Track;
  inputIndex: number | null; // null for text clips
}

function sourceSpanSec(clip: Clip): number {
  return ticksToSeconds(clip.durationTick * clip.speed);
}

export interface CompileOptions {
  /** Normalize final audio loudness to ~ -14 LUFS (EBU R128) for platform delivery. */
  normalizeLoudness?: boolean;
}

export function compileTimeline(doc: ProjectDoc, compileOpts: CompileOptions = {}): CompiledExport {
  const { settings, timeline } = doc;
  const W = settings.width;
  const H = settings.height;
  const fps = settings.fps;
  const durationSec = Math.max(ticksToSeconds(timeline.durationTicks), 0.04);

  const inputs: FfmpegInput[] = [];
  const mediaById = new Map(doc.media.map((m) => [m.id, m]));

  // Collect visual items in z-order: lower track index first (rendered earlier/below).
  const visualTracks = timeline.tracks
    .filter((t) => t.kind === "video" || t.kind === "overlay" || t.kind === "text")
    .sort((a, b) => a.index - b.index);

  const visuals: VisualItem[] = [];
  for (const track of visualTracks) {
    for (const clip of track.clips) {
      let inputIndex: number | null = null;
      if (clip.mediaId && clip.kind !== "text") {
        const media = mediaById.get(clip.mediaId);
        if (!media) continue;
        const startSec = ticksToSeconds(clip.inTick);
        const pre =
          clip.kind === "image"
            ? ["-loop", "1", "-t", s3(ticksToSeconds(clip.durationTick))]
            : ["-ss", s3(startSec), "-t", s3(sourceSpanSec(clip))];
        inputIndex = inputs.length;
        inputs.push({ pre, path: media.path });
      }
      visuals.push({ clip, track, inputIndex });
    }
  }

  // Collect audio contributions grouped by track: audio clips + video clips with audio.
  interface AudioItem {
    clip: Clip;
    inputIndex: number;
  }
  const audioByTrack = new Map<string, { track: Track; items: AudioItem[] }>();
  for (const track of timeline.tracks) {
    if (track.muted) continue;
    if (track.kind !== "audio" && track.kind !== "video") continue;
    for (const clip of track.clips) {
      if (!clip.mediaId) continue;
      const media = mediaById.get(clip.mediaId);
      if (!media || !media.hasAudio) continue;
      const inputIndex = inputs.length;
      inputs.push({
        pre: ["-ss", s3(ticksToSeconds(clip.inTick)), "-t", s3(sourceSpanSec(clip))],
        path: media.path,
      });
      let group = audioByTrack.get(track.id);
      if (!group) {
        group = { track, items: [] };
        audioByTrack.set(track.id, group);
      }
      group.items.push({ clip, inputIndex });
    }
  }

  const chains: string[] = [];

  // --- Video graph ---
  chains.push(
    `color=c=${hexToFfColor(settings.background)}:s=${W}x${H}:r=${fps}:d=${s3(durationSec)},format=yuv420p[bg]`,
  );
  let acc = "bg";
  let vIdx = 0;
  for (const item of visuals) {
    const { clip } = item;
    const startSec = ticksToSeconds(clip.startTick);
    const endSec = ticksToSeconds(clip.startTick + clip.durationTick);
    const enable = `enable='between(t,${s3(startSec)},${s3(endSec)})'`;

    if (clip.kind === "text" && clip.text) {
      const t = clip.text;
      const txt = escapeDrawtext(t.text);
      const parts = [
        `text='${txt}'`,
        `fontcolor=${hexToFfColor(t.style.color)}`,
        `fontsize=${t.style.fontSize}`,
        `x=w*${t.anchor.x}-text_w/2`,
        `y=h*${t.anchor.y}-text_h/2`,
      ];
      if (t.style.outlineWidth)
        parts.push(`borderw=${t.style.outlineWidth}`, `bordercolor=${hexToFfColor(t.style.outlineColor ?? "#000000")}`);
      if (t.style.shadow) parts.push("shadowx=2", "shadowy=2", "shadowcolor=0x000000AA");
      if (t.style.background) parts.push("box=1", `boxcolor=${hexToFfColor(t.style.background)}@0.6`, "boxborderw=12");
      const out = `vt${vIdx++}`;
      chains.push(`[${acc}]drawtext=${parts.join(":")}:${enable}[${out}]`);
      acc = out;
      continue;
    }

    if (item.inputIndex === null) continue;
    const label = `cv${vIdx}`;

    // Transitions. Dissolve-style transitions make this clip overlap the previous clip on
    // its track (render `d` earlier) and cross-fade in via its alpha channel — a REAL
    // cross-dissolve, not a fade to black. from/to-black transitions are luma fades.
    const trans = clip.transitionIn;
    const dissolve = !!trans && DISSOLVE_KINDS.has(trans.kind);
    const transSec = trans ? ticksToSeconds(trans.durationTicks) : 0;
    const renderStartTick = dissolve ? Math.max(0, clip.startTick - trans!.durationTicks) : clip.startTick;
    const renderStartSec = ticksToSeconds(renderStartTick);
    const enableWin = `enable='between(t,${s3(renderStartSec)},${s3(endSec)})'`;

    const filters: string[] = [];
    if (clip.speed !== 1) filters.push(`setpts=PTS/${clip.speed}`);
    const scale = clip.transform?.scale ?? 1;
    const tw = Math.round(W * scale);
    const th = Math.round(H * scale);
    if (clip.fit === "cover") {
      // Fill the frame (no letterbox): scale up to cover, then crop to the canvas.
      filters.push(`scale=${tw}:${th}:force_original_aspect_ratio=increase`, `crop=${tw}:${th}`);
    } else {
      filters.push(`scale=${tw}:${th}:force_original_aspect_ratio=decrease`);
    }
    if (clip.transform?.rotation) filters.push(`rotate=${(clip.transform.rotation * Math.PI) / 180}:c=none`);
    if (clip.color) {
      const c = clip.color;
      filters.push(`eq=brightness=${c.brightness}:contrast=${1 + c.contrast}:saturation=${1 + c.saturation}`);
    }
    // Named visual effects (from apply_effect) — actually rendered, not just stored.
    for (const fx of clip.effects ?? []) {
      const f = effectToFilter(fx.name, fx.params ?? {});
      if (f) filters.push(f);
    }
    const durSec = ticksToSeconds(clip.durationTick);
    let fadeInSec = clip.fades?.inTicks ? ticksToSeconds(clip.fades.inTicks) : 0;
    const fadeOutSec = clip.fades?.outTicks ? ticksToSeconds(clip.fades.outTicks) : 0;
    if (trans && (trans.kind === "fadeFromBlack" || trans.kind === "fadeToBlack")) {
      fadeInSec = Math.max(fadeInSec, transSec);
    }
    if (fadeInSec) filters.push(`fade=t=in:st=0:d=${s3(fadeInSec)}`);
    if (fadeOutSec) filters.push(`fade=t=out:st=${s3(durSec - fadeOutSec)}:d=${s3(fadeOutSec)}`);
    if (dissolve) filters.push("format=yuva420p", `fade=t=in:st=0:d=${s3(transSec)}:alpha=1`);
    filters.push("setpts=PTS-STARTPTS");
    filters.push(`setpts=PTS+${s3(renderStartSec)}/TB`);
    chains.push(`[${item.inputIndex}:v]${filters.join(",")}[${label}]`);

    const tx = clip.transform?.x ?? 0;
    const ty = clip.transform?.y ?? 0;
    // "slide" animates X from off-canvas-right to its final position over the transition.
    let xExpr = `(W-w)/2+${tx}`;
    if (dissolve && trans!.kind === "slide") {
      xExpr = `(W-w)/2+${tx}+W*max(0\\,1-(t-${s3(renderStartSec)})/${s3(Math.max(transSec, 0.001))})`;
    }
    const out = `vo${vIdx++}`;
    chains.push(
      `[${acc}][${label}]overlay=x=${xExpr}:y=(H-h)/2+${ty}:${enableWin}:eof_action=pass[${out}]`,
    );
    acc = out;
  }
  const videoLabel = "vout";
  chains.push(`[${acc}]format=yuv420p,fps=${fps}[${videoLabel}]`);

  // --- Audio graph (per-track streams, then sidechain ducking, then mix) ---
  let audioLabel: string | null = null;
  const trackGroups = [...audioByTrack.values()];
  if (trackGroups.length > 0) {
    let aIdx = 0;
    // 1. Build one stream per track (amix of its positioned clips).
    const trackStream = new Map<string, string>();
    for (const group of trackGroups) {
      const clipLabels: string[] = [];
      for (const item of group.items) {
        const { clip } = item;
        const filters: string[] = ["asetpts=PTS-STARTPTS"];
        if (clip.speed !== 1) for (const f of atempoChain(clip.speed)) filters.push(`atempo=${f}`);
        const vol = clip.volume ?? 1;
        if (vol !== 1) filters.push(`volume=${vol}`);
        const durSec = ticksToSeconds(clip.durationTick);
        if (clip.fades?.inTicks) filters.push(`afade=t=in:st=0:d=${s3(ticksToSeconds(clip.fades.inTicks))}`);
        if (clip.fades?.outTicks)
          filters.push(`afade=t=out:st=${s3(durSec - ticksToSeconds(clip.fades.outTicks))}:d=${s3(ticksToSeconds(clip.fades.outTicks))}`);
        const delayMs = Math.round(ticksToSeconds(clip.startTick) * 1000);
        if (delayMs > 0) filters.push(`adelay=${delayMs}:all=1`);
        const l = `ac${aIdx++}`;
        chains.push(`[${item.inputIndex}:a]${filters.join(",")}[${l}]`);
        clipLabels.push(`[${l}]`);
      }
      const ts = `at${aIdx++}`;
      if (clipLabels.length === 1) chains.push(`${clipLabels[0]}aresample=${settings.sampleRate}[${ts}]`);
      else chains.push(`${clipLabels.join("")}amix=inputs=${clipLabels.length}:normalize=0:dropout_transition=0,aresample=${settings.sampleRate}[${ts}]`);
      trackStream.set(group.track.id, ts);
    }

    // 2. Split any track used as a ducking sidechain so it can feed both the mix and the
    //    sidechaincompress input.
    const sidechainUse = new Map<string, number>();
    for (const g of trackGroups) {
      const under = g.track.duck?.underTrackId;
      if (under && trackStream.has(under)) sidechainUse.set(under, (sidechainUse.get(under) ?? 0) + 1);
    }
    const sideLabels = new Map<string, string[]>();
    for (const [trackId, uses] of sidechainUse) {
      const base = trackStream.get(trackId)!;
      const outs = Array.from({ length: uses + 1 }, (_, i) => `${base}s${i}`);
      chains.push(`[${base}]asplit=${uses + 1}${outs.map((o) => `[${o}]`).join("")}`);
      trackStream.set(trackId, outs[0]!); // main copy goes to the mix
      sideLabels.set(trackId, outs.slice(1));
    }

    // 3. Apply sidechain ducking: compress the ducking track under its reference track.
    for (const g of trackGroups) {
      const duck = g.track.duck;
      if (!duck || !trackStream.has(duck.underTrackId)) continue;
      const side = sideLabels.get(duck.underTrackId)?.shift();
      if (!side) continue;
      const main = trackStream.get(g.track.id)!;
      const out = `${main}d`;
      chains.push(
        `[${main}][${side}]sidechaincompress=threshold=${duck.threshold}:ratio=${duck.ratio}:attack=20:release=300[${out}]`,
      );
      trackStream.set(g.track.id, out);
    }

    // 4. Mix all final track streams (+ optional loudness normalization for delivery).
    const finals = trackGroups.map((g) => `[${trackStream.get(g.track.id)!}]`);
    const ln = compileOpts.normalizeLoudness ? ",loudnorm=I=-14:TP=-1.5:LRA=11" : "";
    audioLabel = "aout";
    if (finals.length === 1) chains.push(`${finals[0]}aresample=${settings.sampleRate}${ln}[${audioLabel}]`);
    else chains.push(`${finals.join("")}amix=inputs=${finals.length}:normalize=0:dropout_transition=0${ln}[${audioLabel}]`);
  }

  const filterComplex = chains.join(";");

  const toArgs = (outputPath: string, encode: EncodeSettings = {}): string[] => {
    const args = ["-y", "-hide_banner"];
    for (const input of inputs) {
      args.push(...input.pre, "-i", input.path);
    }
    args.push("-filter_complex", filterComplex);
    args.push("-map", `[${videoLabel}]`);
    if (audioLabel) args.push("-map", `[${audioLabel}]`);
    // Video encode
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", encode.preset ?? "medium");
    if (encode.videoBitrate) args.push("-b:v", encode.videoBitrate);
    else args.push("-crf", String(encode.crf ?? 20));
    // Audio encode
    if (audioLabel) args.push("-c:a", "aac", "-b:a", encode.audioBitrate ?? "192k");
    args.push("-r", String(encode.fps ?? fps));
    args.push("-t", s3(durationSec));
    args.push("-movflags", "+faststart");
    args.push(outputPath);
    return args;
  };

  const toFrameArgs = (outputPath: string, atSec: number): string[] => {
    const args = ["-y", "-hide_banner"];
    for (const input of inputs) args.push(...input.pre, "-i", input.path);
    args.push("-filter_complex", filterComplex);
    args.push("-map", `[${videoLabel}]`);
    // Seek on the filtered output to the requested composite time, grab one frame.
    args.push("-ss", s3(Math.min(Math.max(atSec, 0), durationSec)), "-frames:v", "1", outputPath);
    return args;
  };

  return { inputs, filterComplex, videoLabel, audioLabel, durationSec, toArgs, toFrameArgs };
}

/**
 * Map a named effect (from apply_effect) to an FFmpeg filter string. Unknown effects are
 * ignored (return null) rather than failing the render. `amount`/`strength` params (0..1)
 * scale the effect where relevant.
 */
export function effectToFilter(name: string, params: Record<string, number | string | boolean>): string | null {
  const num = (k: string, d: number) => (typeof params[k] === "number" ? (params[k] as number) : d);
  switch (name) {
    case "vignette":
      return `vignette=angle=${num("amount", 0.4) * (Math.PI / 2)}`;
    case "blur":
    case "gaussianBlur":
      return `gblur=sigma=${Math.max(0.1, num("amount", 0.5) * 20)}`;
    case "sharpen":
      return `unsharp=5:5:${num("amount", 0.8).toFixed(2)}:5:5:0`;
    case "grayscale":
    case "blackAndWhite":
      return "hue=s=0";
    case "sepia":
      return "colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131";
    case "invert":
    case "negative":
      return "negate";
    case "pixelate": {
      const p = Math.max(2, Math.round(num("amount", 0.3) * 40));
      return `pixelize=${p}:${p}`;
    }
    case "vibrance":
      return `eq=saturation=${1 + num("amount", 0.3)}`;
    case "warm":
      return `colorbalance=rs=${num("amount", 0.2)}:bs=-${num("amount", 0.2)}`;
    case "cool":
      return `colorbalance=rs=-${num("amount", 0.2)}:bs=${num("amount", 0.2)}`;
    case "fadeFilm":
    case "cinematic":
      return "curves=preset=vintage";
    case "zoomIn":
      return `scale=iw*${(1 + num("amount", 0.1)).toFixed(3)}:-1,crop=iw/${(1 + num("amount", 0.1)).toFixed(3)}:ih/${(1 + num("amount", 0.1)).toFixed(3)}`;
    default:
      return null;
  }
}

/** Names that effectToFilter renders (for validation/UI). */
export const RENDERABLE_EFFECTS = [
  "vignette", "blur", "gaussianBlur", "sharpen", "grayscale", "blackAndWhite",
  "sepia", "invert", "negative", "pixelate", "vibrance", "warm", "cool",
  "fadeFilm", "cinematic", "zoomIn",
] as const;

/** atempo only accepts 0.5..2.0; chain factors to reach arbitrary speed. */
export function atempoChain(speed: number): number[] {
  const factors: number[] = [];
  let remaining = speed;
  while (remaining > 2.0) {
    factors.push(2.0);
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    factors.push(0.5);
    remaining /= 0.5;
  }
  factors.push(Number(remaining.toFixed(6)));
  return factors;
}
