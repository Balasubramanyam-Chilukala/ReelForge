/**
 * ReelForge bridge protocol — the contract between the backend daemon and its clients
 * (the desktop UI and the MCP server). Transport: HTTP POST /rpc for request/response,
 * WebSocket for server-pushed events. Loopback-only + per-session token.
 */

import type {
  Command,
  MediaAsset,
  ProjectDoc,
} from "@reelforge/engine";

export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  durationTicks: number;
  trackCount: number;
  mediaCount: number;
}

export interface FfmpegStatus {
  ffmpeg: boolean;
  ffprobe: boolean;
  ffmpegVersion?: string;
  ffprobeVersion?: string;
}

export interface EditorStatus {
  app: string;
  version: string;
  openProjects: string[];
  ffmpeg: FfmpegStatus;
  approvalMode: ApprovalMode;
}

export type ApprovalMode = "auto" | "review";

export interface ActivityEntry {
  at: string;
  source: "user" | "agent" | "system";
  label: string;
  detail?: string;
}

export interface CommandResult {
  doc: ProjectDoc;
  created?: Record<string, string>;
  label: string;
  canUndo: boolean;
  canRedo: boolean;
}

export type JobKind = "export" | "analyze" | "proxy";
export type JobStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface JobState {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  projectId?: string;
  result?: unknown;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface SceneChange {
  tick: number;
  score: number;
}

export interface TranscriptSegmentDTO {
  startTick: number;
  endTick: number;
  text: string;
}
export interface TranscriptDTO {
  language?: string;
  segments: TranscriptSegmentDTO[];
}
export interface TimeSegmentDTO {
  startTick: number;
  endTick: number;
}
export interface WhisperStatus {
  available: boolean;
  provider: "groq" | "local" | "none";
  bin: string | null;
  model: string | null;
  groq: boolean;
}

/** The set of RPC methods and their request/response payloads. */
export interface RpcMethods {
  "editor.status": { req: {}; res: EditorStatus };
  "project.list": { req: {}; res: { projects: ProjectSummary[] } };
  "project.create": {
    req: { name?: string; aspect?: string; fps?: number };
    res: { projectId: string; doc: ProjectDoc };
  };
  "project.open": { req: { projectId: string }; res: { doc: ProjectDoc } };
  "project.save": { req: { projectId: string }; res: { ok: true; savedAt: string } };
  "project.details": {
    req: { projectId: string };
    res: { doc: ProjectDoc; activity: ActivityEntry[]; canUndo: boolean; canRedo: boolean };
  };
  "project.command": {
    req: { projectId: string; command: Command; source?: "user" | "agent" };
    res: CommandResult;
  };
  "project.undo": { req: { projectId: string }; res: CommandResult };
  "project.redo": { req: { projectId: string }; res: CommandResult };
  "media.import": {
    req: { projectId: string; path: string; probe?: boolean };
    res: { mediaId: string; asset: MediaAsset };
  };
  "media.list": { req: { projectId: string }; res: { media: MediaAsset[] } };
  "media.metadata": {
    req: { projectId: string; mediaId: string };
    res: { asset: MediaAsset };
  };
  "media.analyze": {
    req: { projectId: string; mediaId: string };
    res: { asset: MediaAsset; scenes: SceneChange[] };
  };
  "media.scenes": {
    req: { projectId: string; mediaId: string; threshold?: number };
    res: { scenes: SceneChange[] };
  };
  "media.keyframes": {
    req: { projectId: string; mediaId: string; everySec?: number };
    res: { dir: string; count: number };
  };
  "media.contactSheet": {
    req: { projectId: string; mediaId: string };
    res: { path: string };
  };
  "media.transcript": {
    req: { projectId: string; mediaId: string; language?: string; wordLevel?: boolean };
    res: { transcript: TranscriptDTO };
  };
  "media.silence": {
    req: { projectId: string; mediaId: string };
    res: { segments: TimeSegmentDTO[] };
  };
  "captions.generate": {
    req: {
      projectId: string; mediaId: string; preset?: string; trackId?: string; language?: string;
      maxChars?: number; mode?: "phrase" | "word" | "group"; groupSize?: number; animation?: string;
    };
    res: { added: number; trackId: string; mode: string };
  };
  "edit.autoRoughCut": {
    req: { projectId: string; mediaIds: string[]; targetSeconds?: number; removeSilence?: boolean; maxClipSeconds?: number };
    res: { clipsAdded: number; durationTicks: number };
  };
  "edit.autoReframe": {
    req: { projectId: string; fit?: "cover" | "contain" };
    res: { clips: number };
  };
  "edit.punchIn": {
    req: { projectId: string; scale?: number };
    res: { clips: number };
  };
  "whisper.status": { req: {}; res: WhisperStatus };
  "whisper.download": { req: { model: string }; res: { path: string } };
  "whisper.setup": { req: { model?: string }; res: { bin: string; model: string } };
  "preview.frame": {
    req: { projectId: string; atTick: number };
    res: { path: string };
  };
  "export.start": {
    req: {
      projectId: string;
      outputPath: string;
      encode?: { crf?: number; videoBitrate?: string; preset?: string; fps?: number };
      overwrite?: boolean;
      normalizeLoudness?: boolean;
    };
    res: { jobId: string };
  };
  "export.status": { req: { jobId: string }; res: { job: JobState } };
  "job.list": { req: {}; res: { jobs: JobState[] } };
  "job.cancel": { req: { jobId: string }; res: { ok: boolean } };
}

export type RpcMethod = keyof RpcMethods;
export type RpcRequest<M extends RpcMethod> = RpcMethods[M]["req"];
export type RpcResponse<M extends RpcMethod> = RpcMethods[M]["res"];

export interface RpcEnvelope {
  method: RpcMethod;
  params: unknown;
}

export interface RpcOk<T> {
  ok: true;
  result: T;
}
export interface RpcErr {
  ok: false;
  error: { code: string; message: string; details?: unknown };
}
export type RpcReply<T> = RpcOk<T> | RpcErr;
