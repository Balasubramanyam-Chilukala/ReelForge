import { create } from "zustand";
import type { Command, ProjectDoc } from "@reelforge/engine";
import type { ActivityEntry, EditorStatus, JobState, ProjectSummary } from "@reelforge/shared";
import { BridgeClient, type BridgeInfo } from "./bridge/client.js";
import { getBridgeInfo, saveBridgeInfo } from "./bridge/connection.js";

export type View = "home" | "editor" | "export" | "agents" | "settings";
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface Selection {
  clipId?: string;
  trackId?: string;
}

interface AppState {
  client: BridgeClient | null;
  connection: ConnectionStatus;
  connectionError?: string;
  wsOpen: boolean;
  status: EditorStatus | null;
  view: View;
  projects: ProjectSummary[];
  doc: ProjectDoc | null;
  selection: Selection;
  jobs: JobState[];
  activity: ActivityEntry[];
  playheadTick: number;
  pxPerSecond: number;

  connect: (info?: BridgeInfo) => Promise<void>;
  refreshStatus: () => Promise<void>;
  loadProjects: () => Promise<void>;
  createProject: (name: string, aspect: string, fps: number) => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  apply: (command: Command) => Promise<Record<string, string> | undefined>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  importMedia: (path: string) => Promise<void>;
  generateCaptions: (mediaId: string, preset: string, mode: "phrase" | "word" | "group") => Promise<{ added: number } | null>;
  autoRoughCut: (mediaIds: string[], targetSeconds: number, removeSilence: boolean) => Promise<{ clipsAdded: number } | null>;
  autoReframe: (fit: "cover" | "contain") => Promise<{ clips: number } | null>;
  startExport: (outputPath: string, encode: { crf?: number; preset?: string }, overwrite: boolean, normalizeLoudness: boolean) => Promise<string | null>;
  setView: (view: View) => void;
  select: (sel: Selection) => void;
  setPlayhead: (tick: number) => void;
  setZoom: (pxPerSecond: number) => void;
}

export const useStore = create<AppState>((set, get) => ({
  client: null,
  connection: "disconnected",
  wsOpen: false,
  status: null,
  view: "home",
  projects: [],
  doc: null,
  selection: {},
  jobs: [],
  activity: [],
  playheadTick: 0,
  pxPerSecond: 60,

  connect: async (info) => {
    set({ connection: "connecting", connectionError: undefined });
    const resolved = info ?? (await getBridgeInfo());
    if (!resolved) {
      set({ connection: "error", connectionError: "ReelForge backend not found. Start the app/daemon." });
      return;
    }
    if (info) saveBridgeInfo(info);
    const client = new BridgeClient(resolved);
    try {
      const status = await client.rpc("editor.status", {});
      client.connect(
        (event) => {
          const state = get();
          if (event.type === "project.updated" && state.doc && event.projectId === state.doc.id) {
            set({ doc: event.doc });
          } else if (event.type === "activity" && state.doc && event.projectId === state.doc.id) {
            set({ activity: [...state.activity, event.entry].slice(-200) });
          } else if (event.type === "job.progress" || event.type === "job.done") {
            const others = state.jobs.filter((j) => j.id !== event.job.id);
            set({ jobs: [...others, event.job] });
          }
        },
        (open) => set({ wsOpen: open }),
      );
      set({ client, status, connection: "connected" });
      await get().loadProjects();
    } catch (err) {
      set({ connection: "error", connectionError: (err as Error).message });
    }
  },

  refreshStatus: async () => {
    const { client } = get();
    if (!client) return;
    set({ status: await client.rpc("editor.status", {}) });
  },

  loadProjects: async () => {
    const { client } = get();
    if (!client) return;
    const { projects } = await client.rpc("project.list", {});
    set({ projects });
  },

  createProject: async (name, aspect, fps) => {
    const { client } = get();
    if (!client) return;
    const { doc } = await client.rpc("project.create", { name, aspect, fps });
    set({ doc, view: "editor", selection: {}, activity: [], playheadTick: 0 });
    await get().loadProjects();
  },

  openProject: async (projectId) => {
    const { client } = get();
    if (!client) return;
    const details = await client.rpc("project.details", { projectId });
    set({ doc: details.doc, activity: details.activity, view: "editor", selection: {}, playheadTick: 0 });
  },

  apply: async (command) => {
    const { client, doc } = get();
    if (!client || !doc) return undefined;
    const res = await client.rpc("project.command", { projectId: doc.id, command, source: "user" });
    set({ doc: res.doc });
    return res.created;
  },

  undo: async () => {
    const { client, doc } = get();
    if (!client || !doc) return;
    const res = await client.rpc("project.undo", { projectId: doc.id });
    set({ doc: res.doc });
  },

  redo: async () => {
    const { client, doc } = get();
    if (!client || !doc) return;
    const res = await client.rpc("project.redo", { projectId: doc.id });
    set({ doc: res.doc });
  },

  importMedia: async (path) => {
    const { client, doc } = get();
    if (!client || !doc) return;
    await client.rpc("media.import", { projectId: doc.id, path, probe: true });
    const details = await client.rpc("project.details", { projectId: doc.id });
    set({ doc: details.doc });
  },

  generateCaptions: async (mediaId, preset, mode) => {
    const { client, doc } = get();
    if (!client || !doc) return null;
    const res = await client.rpc("captions.generate", { projectId: doc.id, mediaId, preset, mode });
    const details = await client.rpc("project.details", { projectId: doc.id });
    set({ doc: details.doc });
    return { added: res.added };
  },

  autoReframe: async (fit) => {
    const { client, doc } = get();
    if (!client || !doc) return null;
    const res = await client.rpc("edit.autoReframe", { projectId: doc.id, fit });
    const details = await client.rpc("project.details", { projectId: doc.id });
    set({ doc: details.doc });
    return { clips: res.clips };
  },

  autoRoughCut: async (mediaIds, targetSeconds, removeSilence) => {
    const { client, doc } = get();
    if (!client || !doc) return null;
    const res = await client.rpc("edit.autoRoughCut", { projectId: doc.id, mediaIds, targetSeconds, removeSilence });
    const details = await client.rpc("project.details", { projectId: doc.id });
    set({ doc: details.doc });
    return { clipsAdded: res.clipsAdded };
  },

  startExport: async (outputPath, encode, overwrite, normalizeLoudness) => {
    const { client, doc } = get();
    if (!client || !doc) return null;
    const { jobId } = await client.rpc("export.start", { projectId: doc.id, outputPath, encode, overwrite, normalizeLoudness });
    return jobId;
  },

  setView: (view) => set({ view }),
  select: (selection) => set({ selection }),
  setPlayhead: (playheadTick) => set({ playheadTick: Math.max(0, playheadTick) }),
  setZoom: (pxPerSecond) => set({ pxPerSecond: Math.max(10, Math.min(400, pxPerSecond)) }),
}));
