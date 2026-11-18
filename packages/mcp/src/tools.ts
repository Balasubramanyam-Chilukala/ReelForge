/**
 * MCP tool definitions. Each tool validates its parameters (zod) and forwards to the
 * backend bridge. Timeline edits map to `project.command` with the corresponding engine
 * command, so Claude Code and OpenCode share one implementation and there is no editing
 * logic here.
 *
 * Tools that depend on Phase-7 features (local transcription, auto-captions, ducking)
 * return an explicit "not yet available" error rather than a fake success.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Command } from "@reelforge/engine";
import { BridgeClient, BridgeError } from "./client.js";

function ok(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
function fail(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Wrap a handler so BridgeErrors become clean tool errors instead of exceptions. */
function guarded(fn: (args: any) => Promise<CallToolResult>) {
  return async (args: any): Promise<CallToolResult> => {
    try {
      return await fn(args);
    } catch (err) {
      if (err instanceof BridgeError) return fail(`${err.code}: ${err.message}`);
      return fail(`error: ${(err as Error).message}`);
    }
  };
}

const RO = { readOnlyHint: true } as const;
const MUT = { readOnlyHint: false, destructiveHint: false } as const;

const projectId = z.string().describe("Project id (from create_project / list_projects)");
const ticks = (desc: string) => z.number().int().describe(`${desc}, in ticks (90000 ticks = 1 second)`);

export function registerTools(server: McpServer, client: BridgeClient): void {
  const edit = (pid: string, command: Command) =>
    client.rpc("project.command", { projectId: pid, command, source: "agent" });

  // ---------------- Project management ----------------

  server.registerTool(
    "get_editor_status",
    { description: "Report ReelForge status: version, open projects, FFmpeg availability, approval mode.", inputSchema: {}, annotations: RO },
    guarded(async () => ok(await client.rpc("editor.status", {}))),
  );

  server.registerTool(
    "list_projects",
    { description: "List all saved ReelForge projects with summaries.", inputSchema: {}, annotations: RO },
    guarded(async () => ok(await client.rpc("project.list", {}))),
  );

  server.registerTool(
    "create_project",
    {
      description: "Create a new project. aspect is one of 9:16, 16:9, 1:1, 4:5.",
      inputSchema: {
        name: z.string().optional(),
        aspect: z.enum(["9:16", "16:9", "1:1", "4:5"]).optional(),
        fps: z.number().optional(),
      },
      annotations: MUT,
    },
    guarded(async (a) => ok(await client.rpc("project.create", a))),
  );

  server.registerTool(
    "open_project",
    { description: "Open a project and return its full document (settings, media, timeline).", inputSchema: { projectId }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("project.open", { projectId: a.projectId }))),
  );

  server.registerTool(
    "save_project",
    { description: "Persist the project to disk.", inputSchema: { projectId }, annotations: MUT },
    guarded(async (a) => ok(await client.rpc("project.save", { projectId: a.projectId }))),
  );

  server.registerTool(
    "get_project_details",
    { description: "Get the project document plus recent activity log and undo/redo availability.", inputSchema: { projectId }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("project.details", { projectId: a.projectId }))),
  );

  // ---------------- Media management ----------------

  server.registerTool(
    "import_media",
    {
      description: "Import a media file (video/image/audio) by absolute path; probes metadata with FFprobe.",
      inputSchema: { projectId, path: z.string().describe("Absolute path to the media file"), probe: z.boolean().optional() },
      annotations: MUT,
    },
    guarded(async (a) => ok(await client.rpc("media.import", { projectId: a.projectId, path: a.path, probe: a.probe ?? true }))),
  );

  server.registerTool(
    "list_media",
    { description: "List media assets in the project library.", inputSchema: { projectId }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("media.list", { projectId: a.projectId }))),
  );

  server.registerTool(
    "get_media_metadata",
    { description: "Get metadata for one media asset (duration, resolution, fps, audio).", inputSchema: { projectId, mediaId: z.string() }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("media.metadata", { projectId: a.projectId, mediaId: a.mediaId }))),
  );

  server.registerTool(
    "analyze_media",
    { description: "Analyze a media asset: metadata plus detected scene changes (requires FFmpeg).", inputSchema: { projectId, mediaId: z.string() }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("media.analyze", { projectId: a.projectId, mediaId: a.mediaId }))),
  );

  server.registerTool(
    "detect_scenes",
    { description: "Detect scene-change timestamps (ticks + score) in a media asset.", inputSchema: { projectId, mediaId: z.string(), threshold: z.number().optional() }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("media.scenes", { projectId: a.projectId, mediaId: a.mediaId, threshold: a.threshold }))),
  );

  server.registerTool(
    "extract_keyframes",
    { description: "Extract keyframe thumbnails from a media asset to the cache dir.", inputSchema: { projectId, mediaId: z.string(), everySec: z.number().optional() }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("media.keyframes", { projectId: a.projectId, mediaId: a.mediaId, everySec: a.everySec }))),
  );

  server.registerTool(
    "generate_contact_sheet",
    { description: "Generate a tiled contact sheet image for a media asset.", inputSchema: { projectId, mediaId: z.string() }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("media.contactSheet", { projectId: a.projectId, mediaId: a.mediaId }))),
  );

  server.registerTool(
    "get_transcript",
    { description: "Get a speech-to-text transcript (Groq or local whisper.cpp) with timed segments; set wordLevel for per-word timings.", inputSchema: { projectId, mediaId: z.string(), language: z.string().optional(), wordLevel: z.boolean().optional() }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("media.transcript", { projectId: a.projectId, mediaId: a.mediaId, language: a.language, wordLevel: a.wordLevel }))),
  );

  server.registerTool(
    "detect_silence",
    { description: "Return the non-silent (speech) segments of a media asset, as timeline ticks.", inputSchema: { projectId, mediaId: z.string() }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("media.silence", { projectId: a.projectId, mediaId: a.mediaId }))),
  );

  server.registerTool(
    "get_whisper_status",
    { description: "Check whether local transcription (whisper.cpp binary + model) is available.", inputSchema: {}, annotations: RO },
    guarded(async () => ok(await client.rpc("whisper.status", {}))),
  );

  server.registerTool(
    "download_transcription_model",
    { description: "Download a local whisper ggml model (requires user consent; one of tiny.en, base.en, small.en, tiny, base, small).", inputSchema: { model: z.enum(["tiny.en", "base.en", "small.en", "tiny", "base", "small"]) }, annotations: MUT },
    guarded(async (a) => ok(await client.rpc("whisper.download", { model: a.model }))),
  );

  // ---------------- Timeline editing (→ engine commands) ----------------

  server.registerTool(
    "get_timeline",
    { description: "Get the project's timeline (tracks and clips).", inputSchema: { projectId }, annotations: RO },
    guarded(async (a) => {
      const d = await client.rpc("project.open", { projectId: a.projectId });
      return ok(d.doc.timeline);
    }),
  );

  server.registerTool(
    "create_timeline",
    {
      description: "Ensure the timeline has at least the requested number of video/audio/text tracks (adds tracks as needed).",
      inputSchema: { projectId, videoTracks: z.number().int().optional(), audioTracks: z.number().int().optional(), textTracks: z.number().int().optional() },
      annotations: MUT,
    },
    guarded(async (a) => {
      const d = await client.rpc("project.open", { projectId: a.projectId });
      const counts: Record<string, number> = { video: 0, audio: 0, text: 0, overlay: 0 };
      for (const t of d.doc.timeline.tracks) counts[t.kind] = (counts[t.kind] ?? 0) + 1;
      const want = { video: a.videoTracks ?? counts.video, audio: a.audioTracks ?? counts.audio, text: a.textTracks ?? counts.text };
      let last = d;
      for (const kind of ["video", "audio", "text"] as const) {
        while (counts[kind]! < (want[kind] ?? 0)) {
          await edit(a.projectId, { type: "addTrack", params: { kind } });
          counts[kind]!++;
        }
      }
      const fresh = await client.rpc("project.open", { projectId: a.projectId });
      return ok(fresh.doc.timeline);
    }),
  );

  server.registerTool(
    "add_clip",
    {
      description: "Add a media clip to a track. durationTick is the clip length on the timeline. startTick appends after the last clip if omitted.",
      inputSchema: {
        projectId, trackId: z.string(), mediaId: z.string().optional(),
        kind: z.enum(["video", "image", "audio"]),
        startTick: ticks("Timeline start").optional(),
        durationTick: ticks("Clip length"),
        inTick: ticks("Source in-point").optional(),
        speed: z.number().optional(),
        allowOverlap: z.boolean().optional(),
      },
      annotations: MUT,
    },
    guarded(async (a) => ok(await edit(a.projectId, { type: "addClip", params: a }))),
  );

  server.registerTool(
    "remove_clip",
    { description: "Remove a clip from the timeline.", inputSchema: { projectId, clipId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: true } },
    guarded(async (a) => ok(await edit(a.projectId, { type: "removeClip", params: { clipId: a.clipId } }))),
  );

  server.registerTool(
    "trim_clip",
    { description: "Trim a clip edge to a new timeline tick. edge is 'start' or 'end'.", inputSchema: { projectId, clipId: z.string(), edge: z.enum(["start", "end"]), toTick: ticks("New edge position") }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "trimClip", params: { clipId: a.clipId, edge: a.edge, toTick: a.toTick } }))),
  );

  server.registerTool(
    "split_clip",
    { description: "Split a clip into two at an absolute timeline tick.", inputSchema: { projectId, clipId: z.string(), atTick: ticks("Split point") }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "splitClip", params: { clipId: a.clipId, atTick: a.atTick } }))),
  );

  server.registerTool(
    "move_clip",
    { description: "Move a clip to a new start tick and/or a different track.", inputSchema: { projectId, clipId: z.string(), startTick: ticks("New start").optional(), toTrackId: z.string().optional(), allowOverlap: z.boolean().optional() }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "moveClip", params: { clipId: a.clipId, startTick: a.startTick, toTrackId: a.toTrackId, allowOverlap: a.allowOverlap } }))),
  );

  server.registerTool(
    "reorder_clips",
    { description: "Reorder a track's clips end-to-end in the given order.", inputSchema: { projectId, trackId: z.string(), clipIds: z.array(z.string()), gapTicks: ticks("Gap between clips").optional() }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "reorderClips", params: { trackId: a.trackId, clipIds: a.clipIds, gapTicks: a.gapTicks } }))),
  );

  server.registerTool(
    "set_clip_speed",
    { description: "Set a clip's playback speed (1 = normal, 2 = 2x, 0.5 = half).", inputSchema: { projectId, clipId: z.string(), speed: z.number() }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "setClipSpeed", params: { clipId: a.clipId, speed: a.speed } }))),
  );

  server.registerTool(
    "set_clip_transform",
    {
      description: "Set a clip's transform (position x/y px, scale, rotation deg, opacity 0..1).",
      inputSchema: { projectId, clipId: z.string(), x: z.number().optional(), y: z.number().optional(), scale: z.number().optional(), rotation: z.number().optional(), opacity: z.number().optional() },
      annotations: MUT,
    },
    guarded(async (a) => {
      const patch: Record<string, number> = {};
      for (const k of ["x", "y", "scale", "rotation", "opacity"]) if (a[k] !== undefined) patch[k] = a[k];
      return ok(await edit(a.projectId, { type: "setClipTransform", params: { clipId: a.clipId, patch } }));
    }),
  );

  server.registerTool(
    "add_transition",
    { description: "Add an incoming transition to a clip. kind: crossDissolve|fadeToBlack|fadeFromBlack|zoom|slide|wipe|blur.", inputSchema: { projectId, clipId: z.string(), kind: z.enum(["crossDissolve", "fadeToBlack", "fadeFromBlack", "zoom", "slide", "wipe", "blur"]), durationTicks: ticks("Transition length") }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "addTransition", params: { clipId: a.clipId, kind: a.kind, durationTicks: a.durationTicks } }))),
  );

  // ---------------- Captions & text ----------------

  server.registerTool(
    "generate_captions",
    {
      description: "Transcribe a media asset (Groq if GROQ_API_KEY set, else local whisper.cpp) and place timed, styled caption clips on a text track. mode: 'phrase' (sentences), 'word' (one word at a time / karaoke), 'group' (N words at a time, trendy highlight look).",
      inputSchema: {
        projectId, mediaId: z.string(),
        mode: z.enum(["phrase", "word", "group"]).optional(),
        groupSize: z.number().int().optional(),
        preset: z.enum(["clean", "bold", "cinematic", "wordHighlight", "social", "podcast", "minimalWhite"]).optional(),
        animation: z.string().optional(),
        trackId: z.string().optional(), language: z.string().optional(), maxChars: z.number().optional(),
      },
      annotations: MUT,
    },
    guarded(async (a) => ok(await client.rpc("captions.generate", { projectId: a.projectId, mediaId: a.mediaId, preset: a.preset, trackId: a.trackId, language: a.language, maxChars: a.maxChars, mode: a.mode, groupSize: a.groupSize, animation: a.animation }))),
  );

  server.registerTool(
    "setup_transcription",
    { description: "One-click: download a whisper.cpp binary for this platform + a model so local transcription works offline (no cloud, no key). Use when get_whisper_status shows provider 'none'.", inputSchema: { model: z.enum(["tiny.en", "base.en", "small.en", "tiny", "base", "small"]).optional() }, annotations: MUT },
    guarded(async (a) => ok(await client.rpc("whisper.setup", { model: a.model }))),
  );

  server.registerTool(
    "auto_reframe",
    { description: "Reframe all video/image clips to FILL the canvas with no black bars (fit='cover') — the vertical-reel look — or 'contain' to letterbox.", inputSchema: { projectId, fit: z.enum(["cover", "contain"]).optional() }, annotations: MUT },
    guarded(async (a) => ok(await client.rpc("edit.autoReframe", { projectId: a.projectId, fit: a.fit }))),
  );

  server.registerTool(
    "apply_punch_in",
    { description: "Apply a subtle alternating punch-in zoom across video clips for energy on each cut.", inputSchema: { projectId, scale: z.number().optional() }, annotations: MUT },
    guarded(async (a) => ok(await client.rpc("edit.punchIn", { projectId: a.projectId, scale: a.scale }))),
  );

  server.registerTool(
    "set_clip_fit",
    { description: "Set how one clip fills the frame: 'cover' (fill, crop) or 'contain' (fit, letterbox).", inputSchema: { projectId, clipId: z.string(), fit: z.enum(["cover", "contain"]) }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "setClipFit", params: { clipId: a.clipId, fit: a.fit } }))),
  );

  server.registerTool(
    "auto_rough_cut",
    {
      description: "Assemble a rough cut: place usable segments from the given media onto the video track up to targetSeconds, optionally removing silence. The agent then refines with other tools.",
      inputSchema: {
        projectId, mediaIds: z.array(z.string()),
        targetSeconds: z.number().optional(), removeSilence: z.boolean().optional(), maxClipSeconds: z.number().optional(),
      },
      annotations: MUT,
    },
    guarded(async (a) => ok(await client.rpc("edit.autoRoughCut", { projectId: a.projectId, mediaIds: a.mediaIds, targetSeconds: a.targetSeconds, removeSilence: a.removeSilence, maxClipSeconds: a.maxClipSeconds }))),
  );

  server.registerTool(
    "add_text_overlay",
    {
      description: "Add a text overlay clip on a text track (created if trackId omitted). anchor x/y are 0..1 (0.5 = center).",
      inputSchema: {
        projectId, trackId: z.string().optional(),
        startTick: ticks("Start"), durationTick: ticks("Duration"),
        text: z.string(),
        fontFamily: z.string().optional(), fontSize: z.number().optional(), color: z.string().optional(),
        anchorX: z.number().optional(), anchorY: z.number().optional(),
        preset: z.string().optional(),
      },
      annotations: MUT,
    },
    guarded(async (a) => {
      let trackId = a.trackId as string | undefined;
      if (!trackId) {
        const created = await edit(a.projectId, { type: "addTrack", params: { kind: "text" } });
        trackId = created.created!.trackId!;
      }
      const style = applyPreset(a.preset, { fontFamily: a.fontFamily ?? "Inter", fontSize: a.fontSize ?? 72, color: a.color ?? "#ffffff" });
      return ok(await edit(a.projectId, {
        type: "addTextOverlay",
        params: { trackId, startTick: a.startTick, durationTick: a.durationTick, text: { text: a.text, style, anchor: { x: a.anchorX ?? 0.5, y: a.anchorY ?? 0.82 } } },
      }));
    }),
  );

  server.registerTool(
    "edit_caption",
    { description: "Edit a text/caption clip's text and/or style.", inputSchema: { projectId, clipId: z.string(), text: z.string().optional(), fontSize: z.number().optional(), color: z.string().optional(), preset: z.string().optional() }, annotations: MUT },
    guarded(async (a) => {
      const stylePatch = applyPreset(a.preset, {});
      if (a.fontSize !== undefined) stylePatch.fontSize = a.fontSize;
      if (a.color !== undefined) stylePatch.color = a.color;
      return ok(await edit(a.projectId, { type: "editText", params: { clipId: a.clipId, text: a.text, stylePatch } }));
    }),
  );

  server.registerTool(
    "style_captions",
    { description: "Apply a named caption style preset to a text clip. Presets: clean, bold, cinematic, wordHighlight, social, podcast, minimalWhite.", inputSchema: { projectId, clipId: z.string(), preset: z.enum(["clean", "bold", "cinematic", "wordHighlight", "social", "podcast", "minimalWhite"]) }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "editText", params: { clipId: a.clipId, stylePatch: applyPreset(a.preset, {}) } }))),
  );

  server.registerTool(
    "animate_text",
    { description: "Set a text clip's animation preset (e.g. fadeIn, popIn, slideUp, typewriter).", inputSchema: { projectId, clipId: z.string(), animation: z.string() }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "editText", params: { clipId: a.clipId, animation: a.animation } }))),
  );

  // ---------------- Audio & effects ----------------

  server.registerTool(
    "add_audio_track",
    { description: "Add an audio track.", inputSchema: { projectId, name: z.string().optional() }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "addTrack", params: { kind: "audio", name: a.name } }))),
  );

  server.registerTool(
    "adjust_audio",
    { description: "Set a clip's audio volume (1 = unity, 0 = mute, 2 = +6dB-ish).", inputSchema: { projectId, clipId: z.string(), volume: z.number() }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "setClipVolume", params: { clipId: a.clipId, volume: a.volume } }))),
  );

  server.registerTool(
    "set_audio_fade",
    { description: "Set audio fade-in/out durations on a clip (ticks).", inputSchema: { projectId, clipId: z.string(), inTicks: ticks("Fade in").optional(), outTicks: ticks("Fade out").optional() }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "setClipFades", params: { clipId: a.clipId, inTicks: a.inTicks, outTicks: a.outTicks } }))),
  );

  server.registerTool(
    "apply_audio_ducking",
    {
      description: "Duck a music track under a voice track using sidechain compression on export. Pass underTrackId=null on the music track to clear ducking.",
      inputSchema: { projectId, musicTrackId: z.string(), voiceTrackId: z.string().nullable(), ratio: z.number().optional(), threshold: z.number().optional() },
      annotations: MUT,
    },
    guarded(async (a) => ok(await edit(a.projectId, { type: "setTrackDuck", params: { trackId: a.musicTrackId, underTrackId: a.voiceTrackId, ratio: a.ratio, threshold: a.threshold } }))),
  );

  server.registerTool(
    "apply_color_adjustment",
    { description: "Adjust a clip's color (brightness/contrast/saturation/temperature, each -1..1).", inputSchema: { projectId, clipId: z.string(), brightness: z.number().optional(), contrast: z.number().optional(), saturation: z.number().optional(), temperature: z.number().optional() }, annotations: MUT },
    guarded(async (a) => {
      const patch: Record<string, number> = {};
      for (const k of ["brightness", "contrast", "saturation", "temperature"]) if (a[k] !== undefined) patch[k] = a[k];
      return ok(await edit(a.projectId, { type: "setClipColor", params: { clipId: a.clipId, patch } }));
    }),
  );

  server.registerTool(
    "apply_effect",
    { description: "Apply/replace a named effect on a clip (e.g. vignette, blur, sharpen, zoomIn, zoomOut, pan).", inputSchema: { projectId, clipId: z.string(), name: z.string(), params: z.record(z.union([z.number(), z.string(), z.boolean()])).optional() }, annotations: MUT },
    guarded(async (a) => ok(await edit(a.projectId, { type: "applyEffect", params: { clipId: a.clipId, name: a.name, params: a.params } }))),
  );

  // ---------------- Preview & rendering ----------------

  server.registerTool(
    "capture_preview_frame",
    { description: "Render a single composited preview frame at a timeline tick; returns the image path.", inputSchema: { projectId, atTick: ticks("Timeline position") }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("preview.frame", { projectId: a.projectId, atTick: a.atTick }))),
  );

  server.registerTool(
    "render_preview",
    { description: "Render a composited preview frame (alias of capture_preview_frame).", inputSchema: { projectId, atTick: ticks("Timeline position").optional() }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("preview.frame", { projectId: a.projectId, atTick: a.atTick ?? 0 }))),
  );

  server.registerTool(
    "export_video",
    {
      description: "Export the project to an MP4 (H.264/AAC). Returns a jobId; poll get_export_status. Refuses to overwrite unless overwrite=true. normalizeLoudness applies -14 LUFS platform loudness.",
      inputSchema: {
        projectId, outputPath: z.string().describe("Absolute output .mp4 path"),
        crf: z.number().optional(), videoBitrate: z.string().optional(),
        preset: z.enum(["ultrafast", "veryfast", "fast", "medium", "slow"]).optional(),
        fps: z.number().optional(), overwrite: z.boolean().optional(),
        normalizeLoudness: z.boolean().optional(),
      },
      annotations: MUT,
    },
    guarded(async (a) =>
      ok(await client.rpc("export.start", { projectId: a.projectId, outputPath: a.outputPath, encode: { crf: a.crf, videoBitrate: a.videoBitrate, preset: a.preset, fps: a.fps }, overwrite: a.overwrite, normalizeLoudness: a.normalizeLoudness }))),
  );

  server.registerTool(
    "get_export_status",
    { description: "Get the status/progress/result of an export job.", inputSchema: { jobId: z.string() }, annotations: RO },
    guarded(async (a) => ok(await client.rpc("export.status", { jobId: a.jobId }))),
  );

  // ---------------- History ----------------

  server.registerTool(
    "undo",
    { description: "Undo the last edit on a project.", inputSchema: { projectId }, annotations: MUT },
    guarded(async (a) => ok(await client.rpc("project.undo", { projectId: a.projectId }))),
  );

  server.registerTool(
    "redo",
    { description: "Redo the last undone edit on a project.", inputSchema: { projectId }, annotations: MUT },
    guarded(async (a) => ok(await client.rpc("project.redo", { projectId: a.projectId }))),
  );
}

// ---- Caption style presets (also used by the UI) ----

type Style = Record<string, unknown>;
const PRESETS: Record<string, Style> = {
  clean: { fontFamily: "Inter", fontSize: 64, color: "#ffffff", shadow: true, preset: "clean" },
  bold: { fontFamily: "Inter", fontSize: 86, color: "#ffffff", bold: true, outlineColor: "#000000", outlineWidth: 6, preset: "bold" },
  cinematic: { fontFamily: "Georgia", fontSize: 56, color: "#f5f5f5", shadow: true, preset: "cinematic" },
  wordHighlight: { fontFamily: "Inter", fontSize: 80, color: "#ffffff", bold: true, highlightColor: "#ffd60a", preset: "wordHighlight" },
  social: { fontFamily: "Inter", fontSize: 84, color: "#ffffff", bold: true, background: "#000000", preset: "social" },
  podcast: { fontFamily: "Inter", fontSize: 60, color: "#ffffff", outlineColor: "#111111", outlineWidth: 3, preset: "podcast" },
  minimalWhite: { fontFamily: "Helvetica", fontSize: 58, color: "#ffffff", shadow: true, preset: "minimalWhite" },
};

function applyPreset(preset: string | undefined, base: Style): Style {
  if (preset && PRESETS[preset]) return { ...base, ...PRESETS[preset] };
  return base;
}

export const CAPTION_PRESETS = Object.keys(PRESETS);
