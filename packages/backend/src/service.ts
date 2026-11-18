/**
 * ProjectService — the backend's core. Owns authoritative EditDocuments in memory,
 * persists to the Database (autosave on every mutation), runs media operations via
 * FFmpeg, and emits events. The HTTP/WS bridge and the in-process test harness both drive
 * this same service, so there is one implementation of every capability.
 */

import { basename } from "node:path";
import {
  EditDocument,
  captionStyle,
  clipEnd,
  createProject,
  findMedia,
  migrate,
  ticksToSeconds,
  type CaptionPreset,
  type Command,
  type MediaAsset,
  type ProjectDoc,
} from "@reelforge/engine";
import {
  FfmpegNotFoundError,
  compileTimeline,
  detectFfmpeg,
  detectScenes,
  detectSpeechSegments,
  detectWhisper,
  downloadWhisperBinary,
  downloadWhisperModel,
  exportTimeline,
  extractKeyframes,
  generateContactSheet,
  probeMedia,
  runRaw,
  runTranscription,
  type FfmpegTools,
  type Segment,
  type SttProvider,
  type Transcript,
  type WhisperModelName,
  type WhisperTools,
  type WordTiming,
} from "@reelforge/media";
import type {
  ActivityEntry,
  ApprovalMode,
  BridgeEvent,
  CommandResult,
  EditorStatus,
  JobState,
  ProjectSummary,
  SceneChange,
} from "@reelforge/shared";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Database } from "./db.js";
import { JobQueue } from "./jobs.js";
import { appDataDir, cacheDir, ensureDir } from "./paths.js";

export interface ServiceOptions {
  version?: string;
  tools?: FfmpegTools;
  approvalMode?: ApprovalMode;
  emit?: (event: BridgeEvent) => void;
}

export class ProjectService {
  private readonly db: Database;
  private readonly open = new Map<string, EditDocument>();
  private readonly version: string;
  private tools: FfmpegTools;
  private approvalMode: ApprovalMode;
  private readonly emit: (event: BridgeEvent) => void;
  readonly jobs: JobQueue;

  constructor(db: Database, opts: ServiceOptions = {}) {
    this.db = db;
    this.version = opts.version ?? "0.1.0";
    this.tools = opts.tools ?? { ffmpeg: null, ffprobe: null };
    this.approvalMode = opts.approvalMode ?? "auto";
    this.emit = opts.emit ?? (() => {});
    this.jobs = new JobQueue((job) =>
      this.emit(job.status === "done" ? { type: "job.done", job } : { type: "job.progress", job }),
    );
  }

  static async create(db: Database, opts: ServiceOptions = {}): Promise<ProjectService> {
    const tools = opts.tools ?? (await detectFfmpeg());
    return new ProjectService(db, { ...opts, tools });
  }

  // ---- Status / listing ----

  status(): EditorStatus {
    return {
      app: "ReelForge",
      version: this.version,
      openProjects: [...this.open.keys()],
      approvalMode: this.approvalMode,
      ffmpeg: {
        ffmpeg: !!this.tools.ffmpeg,
        ffprobe: !!this.tools.ffprobe,
        ffmpegVersion: this.tools.ffmpegVersion,
        ffprobeVersion: this.tools.ffprobeVersion,
      },
    };
  }

  setApprovalMode(mode: ApprovalMode): void {
    this.approvalMode = mode;
  }

  listProjects(): ProjectSummary[] {
    return this.db.listProjects();
  }

  // ---- Project lifecycle ----

  createProject(params: { name?: string; aspect?: string; fps?: number } = {}): {
    projectId: string;
    doc: ProjectDoc;
  } {
    const doc = createProject({
      name: params.name,
      aspect: (params.aspect as any) ?? "9:16",
      fps: params.fps ?? 30,
    });
    const edit = new EditDocument(doc);
    this.open.set(doc.id, edit);
    this.db.upsertProject(doc);
    this.activity(doc.id, "system", "Create project");
    return { projectId: doc.id, doc };
  }

  openProject(projectId: string): ProjectDoc {
    return this.require(projectId).doc;
  }

  saveProject(projectId: string): { ok: true; savedAt: string } {
    const edit = this.require(projectId);
    this.db.upsertProject(edit.doc);
    return { ok: true, savedAt: new Date().toISOString() };
  }

  details(projectId: string): {
    doc: ProjectDoc;
    activity: ActivityEntry[];
    canUndo: boolean;
    canRedo: boolean;
  } {
    const edit = this.require(projectId);
    return {
      doc: edit.doc,
      activity: this.db.listActivity(projectId),
      canUndo: edit.canUndo(),
      canRedo: edit.canRedo(),
    };
  }

  // ---- Editing (the single mutation path, used by UI and agents) ----

  applyCommand(projectId: string, command: Command, source: "user" | "agent" = "user"): CommandResult {
    const edit = this.require(projectId);
    const result = edit.apply(command);
    this.persistAndBroadcast(projectId, edit, result.label, source, result.created);
    return {
      doc: edit.doc,
      created: result.created,
      label: result.label,
      canUndo: edit.canUndo(),
      canRedo: edit.canRedo(),
    };
  }

  undo(projectId: string): CommandResult {
    const edit = this.require(projectId);
    const result = edit.undo();
    const label = result?.label ?? "nothing to undo";
    if (result) this.persistAndBroadcast(projectId, edit, label, "user");
    return { doc: edit.doc, label, canUndo: edit.canUndo(), canRedo: edit.canRedo() };
  }

  redo(projectId: string): CommandResult {
    const edit = this.require(projectId);
    const result = edit.redo();
    const label = result?.label ?? "nothing to redo";
    if (result) this.persistAndBroadcast(projectId, edit, label, "user");
    return { doc: edit.doc, label, canUndo: edit.canUndo(), canRedo: edit.canRedo() };
  }

  // ---- Media ----

  async importMedia(
    projectId: string,
    path: string,
    probe = true,
  ): Promise<{ mediaId: string; asset: MediaAsset }> {
    this.require(projectId);
    let assetInput: Omit<MediaAsset, "id" | "importedAt"> & { id?: string } = {
      kind: "video",
      path,
      name: basename(path),
      probeStatus: "pending",
    };
    if (probe && this.tools.ffprobe) {
      try {
        const probed = await probeMedia(path, this.tools);
        assetInput = {
          kind: probed.kind,
          path,
          name: basename(path),
          durationTicks: probed.durationTicks,
          width: probed.width,
          height: probed.height,
          fps: probed.fps,
          hasAudio: probed.hasAudio,
          probeStatus: "ready",
        };
      } catch (err) {
        assetInput.probeStatus = "error";
        assetInput.probeError = (err as Error).message;
      }
    }
    const result = this.applyCommand(projectId, { type: "addMedia", params: { asset: assetInput } }, "user");
    const mediaId = result.created!.mediaId!;
    const asset = findMedia(result.doc, mediaId)!;
    return { mediaId, asset };
  }

  listMedia(projectId: string): MediaAsset[] {
    return this.require(projectId).doc.media;
  }

  mediaMetadata(projectId: string, mediaId: string): MediaAsset {
    const asset = findMedia(this.require(projectId).doc, mediaId);
    if (!asset) throw new ServiceError("NOT_FOUND", `media not found: ${mediaId}`);
    return asset;
  }

  async detectScenes(projectId: string, mediaId: string, threshold = 0.3): Promise<SceneChange[]> {
    const asset = this.mediaMetadata(projectId, mediaId);
    this.requireFfmpeg();
    const scenes = await detectScenes(this.tools, asset.path, threshold);
    return scenes.map((s) => ({ tick: s.tick, score: s.score }));
  }

  async analyze(projectId: string, mediaId: string): Promise<{ asset: MediaAsset; scenes: SceneChange[] }> {
    const asset = this.mediaMetadata(projectId, mediaId);
    const scenes = this.tools.ffmpeg ? await this.detectScenes(projectId, mediaId) : [];
    return { asset, scenes };
  }

  async extractKeyframes(projectId: string, mediaId: string, everySec = 2): Promise<{ dir: string; count: number }> {
    const asset = this.mediaMetadata(projectId, mediaId);
    this.requireFfmpeg();
    const dir = ensureDir(join(cacheDir(), "keyframes", mediaId));
    await extractKeyframes(this.tools, asset.path, dir, everySec);
    const { readdirSync } = await import("node:fs");
    return { dir, count: readdirSync(dir).length };
  }

  async contactSheet(projectId: string, mediaId: string): Promise<{ path: string }> {
    const asset = this.mediaMetadata(projectId, mediaId);
    this.requireFfmpeg();
    const out = join(ensureDir(join(cacheDir(), "contact")), `${mediaId}.jpg`);
    await generateContactSheet(this.tools, asset.path, out);
    return { path: out };
  }

  // ---- Transcription & captions (Phase 7) ----

  private whisperModelsDir(): string {
    return ensureDir(join(cacheDir(), "whisper-models"));
  }
  private whisperBinDir(): string {
    return ensureDir(join(appDataDir(), "whisper"));
  }

  getWhisper(): WhisperTools {
    return detectWhisper(this.whisperModelsDir(), this.whisperBinDir());
  }

  private groqKey(): string | undefined {
    return process.env.GROQ_API_KEY || undefined;
  }

  /** Pick the transcription provider: Groq when a key is set, else local whisper.cpp. */
  private sttProvider(wordLevel: boolean, language?: string): SttProvider {
    const key = this.groqKey();
    if (key) return { kind: "groq", apiKey: key, wordLevel, language };
    const whisper = this.getWhisper();
    if (!whisper.bin || !whisper.model) {
      throw new ServiceError(
        "STT_UNAVAILABLE",
        "No transcription available. Set GROQ_API_KEY for cloud transcription, or install whisper.cpp + a model (use setup_transcription).",
      );
    }
    return { kind: "local", whisper, wordLevel, language };
  }

  whisperStatus(): {
    available: boolean;
    provider: "groq" | "local" | "none";
    bin: string | null;
    model: string | null;
    groq: boolean;
  } {
    const w = this.getWhisper();
    const groq = !!this.groqKey();
    const localReady = !!(w.bin && w.model);
    return {
      available: groq || localReady,
      provider: groq ? "groq" : localReady ? "local" : "none",
      bin: w.bin,
      model: w.model,
      groq,
    };
  }

  async downloadWhisperModel(name: WhisperModelName): Promise<{ path: string }> {
    const path = await downloadWhisperModel(name, this.whisperModelsDir());
    return { path };
  }

  /** One-click: download the whisper.cpp binary (platform-appropriate) + a default model. */
  async setupTranscription(model: WhisperModelName = "base.en"): Promise<{ bin: string; model: string }> {
    const bin = await downloadWhisperBinary(this.whisperBinDir());
    const modelPath = await downloadWhisperModel(model, this.whisperModelsDir());
    return { bin, model: modelPath };
  }

  async transcript(projectId: string, mediaId: string, language?: string, wordLevel = false): Promise<Transcript> {
    const asset = this.mediaMetadata(projectId, mediaId);
    this.requireFfmpeg();
    return runTranscription(asset.path, this.tools, this.sttProvider(wordLevel, language));
  }

  async detectSilence(projectId: string, mediaId: string): Promise<Segment[]> {
    const asset = this.mediaMetadata(projectId, mediaId);
    this.requireFfmpeg();
    const totalSec = asset.durationTicks ? ticksToSeconds(asset.durationTicks) : 0;
    return detectSpeechSegments(this.tools, asset.path, totalSec);
  }

  /**
   * Transcribe a media asset and lay timed caption clips on a text track, mapping each
   * segment's source time to its position on the timeline (honoring the clip's trim/speed).
   */
  async generateCaptions(
    projectId: string,
    mediaId: string,
    opts: {
      preset?: CaptionPreset;
      trackId?: string;
      language?: string;
      maxChars?: number;
      /** 'phrase' = one clip per sentence; 'word' = one word at a time (karaoke); 'group'
       *  = N words at a time with the trendy highlight look. */
      mode?: "phrase" | "word" | "group";
      groupSize?: number;
      animation?: string;
    } = {},
  ): Promise<{ added: number; trackId: string; mode: string }> {
    const edit = this.require(projectId);
    const mode = opts.mode ?? "phrase";
    const wordLevel = mode !== "phrase";
    const transcript = await this.transcript(projectId, mediaId, opts.language, wordLevel);

    let trackId = opts.trackId;
    if (!trackId) {
      const existing = edit.doc.timeline.tracks.find((t) => t.kind === "text");
      if (existing) trackId = existing.id;
      else {
        const created = this.applyCommand(projectId, { type: "addTrack", params: { kind: "text" } }, "agent");
        trackId = created.created!.trackId!;
      }
    }

    const defaultPreset: CaptionPreset = mode === "phrase" ? "clean" : "wordHighlight";
    const style = captionStyle(opts.preset ?? defaultPreset);
    const animation = opts.animation ?? (mode === "phrase" ? undefined : "pop");
    const units = buildCaptionUnits(transcript, mode, opts.groupSize ?? 3);

    let added = 0;
    for (const unit of units) {
      const text = opts.maxChars ? truncate(unit.text, opts.maxChars) : unit.text;
      if (!text) continue;
      const placed = mapSourceSegmentToTimeline(this.require(projectId).doc, mediaId, unit.startTick, unit.endTick);
      try {
        this.applyCommand(
          projectId,
          {
            type: "addTextOverlay",
            params: {
              trackId,
              startTick: placed.startTick,
              durationTick: Math.max(6000, placed.endTick - placed.startTick),
              text: { text, style, anchor: { x: 0.5, y: 0.8 }, animation },
              allowOverlap: true,
            },
          },
          "agent",
        );
        added++;
      } catch {
        /* skip a unit that can't be placed */
      }
    }
    return { added, trackId, mode };
  }

  // ---- Trending one-shot edits ----

  /** Reframe all video/overlay clips to fill the canvas (no black bars) or fit it. */
  autoReframe(projectId: string, fit: "cover" | "contain" = "cover"): { clips: number } {
    const doc = this.require(projectId).doc;
    let n = 0;
    for (const track of doc.timeline.tracks) {
      if (track.kind !== "video" && track.kind !== "overlay") continue;
      for (const clip of track.clips) {
        if (clip.kind === "video" || clip.kind === "image") {
          this.applyCommand(projectId, { type: "setClipFit", params: { clipId: clip.id, fit } }, "agent");
          n++;
        }
      }
    }
    return { clips: n };
  }

  /** Apply a subtle punch-in zoom to clips (trendy energy on each cut). */
  autoPunchIn(projectId: string, scale = 1.08): { clips: number } {
    const doc = this.require(projectId).doc;
    let n = 0;
    for (const track of doc.timeline.tracks) {
      if (track.kind !== "video") continue;
      for (const clip of track.clips) {
        if (clip.kind !== "video" && clip.kind !== "image") continue;
        // Alternate in/out so successive cuts feel dynamic.
        const s = n % 2 === 0 ? scale : 1;
        this.applyCommand(projectId, { type: "setClipTransform", params: { clipId: clip.id, patch: { scale: s } } }, "agent");
        n++;
      }
    }
    return { clips: n };
  }

  /**
   * Assemble a rough cut from media: for each asset, pick usable segments (speech when
   * removeSilence, else the whole asset trimmed to maxClip) and place them sequentially on
   * the video track up to targetSeconds. This is the deterministic "auto-edit" helper; the
   * agent refines the result with further tool calls.
   */
  async autoRoughCut(
    projectId: string,
    mediaIds: string[],
    opts: { targetSeconds?: number; removeSilence?: boolean; maxClipSeconds?: number } = {},
  ): Promise<{ clipsAdded: number; durationTicks: number }> {
    this.require(projectId);
    this.requireFfmpeg();
    const target = (opts.targetSeconds ?? 30) * 90_000;
    const maxClip = (opts.maxClipSeconds ?? 4) * 90_000;
    let videoTrack = this.require(projectId).doc.timeline.tracks.find((t) => t.kind === "video");
    if (!videoTrack) {
      const created = this.applyCommand(projectId, { type: "addTrack", params: { kind: "video" } }, "agent");
      videoTrack = this.require(projectId).doc.timeline.tracks.find((t) => t.id === created.created!.trackId);
    }
    const trackId = videoTrack!.id;

    let placed = 0;
    let clipsAdded = 0;
    for (const mediaId of mediaIds) {
      if (placed >= target) break;
      const asset = this.mediaMetadata(projectId, mediaId);
      if (asset.kind === "audio") continue;
      let segments: Segment[];
      if (opts.removeSilence && asset.hasAudio) {
        segments = await this.detectSilence(projectId, mediaId);
      } else {
        const dur = asset.durationTicks ?? maxClip;
        segments = [{ startTick: 0, endTick: dur }];
      }
      for (const seg of segments) {
        if (placed >= target) break;
        let inTick = seg.startTick;
        const segEnd = seg.endTick;
        while (inTick < segEnd && placed < target) {
          const take = Math.min(maxClip, segEnd - inTick, target - placed);
          if (take < 9000) break; // skip sub-0.1s fragments
          try {
            this.applyCommand(
              projectId,
              { type: "addClip", params: { trackId, kind: asset.kind, mediaId, durationTick: take, inTick } },
              "agent",
            );
            placed += take;
            clipsAdded++;
          } catch {
            break;
          }
          inTick += take;
        }
      }
    }
    return { clipsAdded, durationTicks: this.require(projectId).doc.timeline.durationTicks };
  }

  // ---- Preview ----

  async previewFrame(projectId: string, atTick: number): Promise<{ path: string }> {
    const edit = this.require(projectId);
    this.requireFfmpeg();
    const compiled = compileTimeline(edit.doc);
    const out = join(ensureDir(join(cacheDir(), "preview")), `${projectId}_${randomUUID()}.png`);
    const atSec = atTick / 90_000;
    const res = await runRaw(this.tools.ffmpeg!, compiled.toFrameArgs(out, atSec), { timeoutMs: 60_000 });
    if (res.code !== 0) throw new ServiceError("RENDER", `preview render failed: ${res.stderr.slice(-500)}`);
    return { path: out };
  }

  // ---- Export (job) ----

  startExport(
    projectId: string,
    outputPath: string,
    encode?: { crf?: number; videoBitrate?: string; preset?: string; fps?: number },
    overwrite = false,
    normalizeLoudness = false,
  ): string {
    const edit = this.require(projectId);
    this.requireFfmpeg();
    const doc = edit.doc;
    const jobId = this.jobs.enqueue("export", projectId, async (ctx) => {
      const result = await exportTimeline(doc, this.tools, {
        outputPath,
        encode: encode as any,
        overwrite,
        normalizeLoudness,
        signal: ctx.signal,
        onProgress: (p) => ctx.report(p.progress),
      });
      this.db.recordExport({
        id: `exp_${randomUUID()}`,
        projectId,
        outputPath: result.outputPath,
        createdAt: new Date().toISOString(),
        durationSec: result.durationSec,
        width: result.width,
        height: result.height,
        sizeBytes: result.sizeBytes,
      });
      this.activity(projectId, "system", "Export complete", `${basename(outputPath)} (${result.width}x${result.height})`);
      return result;
    });
    this.activity(projectId, "user", "Export started", basename(outputPath));
    return jobId;
  }

  exportStatus(jobId: string): JobState {
    const job = this.jobs.get(jobId);
    if (!job) throw new ServiceError("NOT_FOUND", `job not found: ${jobId}`);
    return job;
  }

  // ---- Internals ----

  private require(projectId: string): EditDocument {
    const open = this.open.get(projectId);
    if (open) return open;
    const stored = this.db.getProject(projectId);
    if (!stored) throw new ServiceError("NOT_FOUND", `project not found: ${projectId}`);
    const migrated = migrate(stored.doc);
    const edit = new EditDocument(migrated.doc);
    this.open.set(projectId, edit);
    if (migrated.migrated) this.db.upsertProject(migrated.doc);
    return edit;
  }

  private requireFfmpeg(): void {
    if (!this.tools.ffmpeg) throw new FfmpegNotFoundError("ffmpeg");
  }

  private persistAndBroadcast(
    projectId: string,
    edit: EditDocument,
    label: string,
    source: "user" | "agent",
    created?: Record<string, string>,
  ): void {
    this.db.upsertProject(edit.doc);
    this.emit({ type: "project.updated", projectId, doc: edit.doc, label, source });
    this.activity(projectId, source, label, created ? JSON.stringify(created) : undefined);
  }

  private activity(projectId: string, source: ActivityEntry["source"], label: string, detail?: string): void {
    const entry: ActivityEntry = { at: new Date().toISOString(), source, label, detail };
    this.db.appendActivity(projectId, entry);
    this.emit({ type: "activity", projectId, entry });
  }
}

/**
 * Map a media-source time range to a timeline range via the first clip referencing that
 * media (honoring the clip's trim in-point and speed). Pure — unit-tested. Returns null
 * never (falls back to absolute timeline) so captions always place somewhere sensible.
 */
export function mapSourceSegmentToTimeline(
  doc: ProjectDoc,
  mediaId: string,
  srcStart: number,
  srcEnd: number,
): { startTick: number; endTick: number } {
  for (const track of doc.timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.mediaId !== mediaId) continue;
      const sourceSpan = clip.durationTick * clip.speed;
      const clipSrcEnd = clip.inTick + sourceSpan;
      if (srcStart >= clip.inTick && srcStart < clipSrcEnd) {
        const startTick = clip.startTick + Math.round((srcStart - clip.inTick) / clip.speed);
        const endTick = Math.min(
          clipEnd(clip),
          clip.startTick + Math.round((srcEnd - clip.inTick) / clip.speed),
        );
        return { startTick, endTick };
      }
    }
  }
  return { startTick: srcStart, endTick: srcEnd };
}

interface CaptionUnit {
  startTick: number;
  endTick: number;
  text: string;
}

/** Break a transcript into caption units for the chosen mode (pure, unit-tested). */
export function buildCaptionUnits(
  transcript: Transcript,
  mode: "phrase" | "word" | "group",
  groupSize: number,
): CaptionUnit[] {
  if (mode === "phrase") {
    return transcript.segments.map((s) => ({ startTick: s.startTick, endTick: s.endTick, text: s.text }));
  }
  const words = transcript.words ?? deriveWords(transcript.segments);
  if (mode === "word") {
    return words.map((w) => ({ startTick: w.startTick, endTick: w.endTick, text: w.text }));
  }
  // group
  const size = Math.max(1, groupSize);
  const out: CaptionUnit[] = [];
  for (let i = 0; i < words.length; i += size) {
    const chunk = words.slice(i, i + size);
    if (!chunk.length) break;
    out.push({
      startTick: chunk[0]!.startTick,
      endTick: chunk[chunk.length - 1]!.endTick,
      text: chunk.map((w) => w.text).join(" "),
    });
  }
  return out;
}

/** Approximate word timings by splitting each segment's text evenly across its duration. */
function deriveWords(segments: Transcript["segments"]): WordTiming[] {
  const words: WordTiming[] = [];
  for (const seg of segments) {
    const tokens = seg.text.split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    const span = Math.max(1, seg.endTick - seg.startTick);
    const per = span / tokens.length;
    tokens.forEach((tok, i) => {
      words.push({
        startTick: Math.round(seg.startTick + i * per),
        endTick: Math.round(seg.startTick + (i + 1) * per),
        text: tok,
      });
    });
  }
  return words;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)).trimEnd() + "…";
}

export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}
