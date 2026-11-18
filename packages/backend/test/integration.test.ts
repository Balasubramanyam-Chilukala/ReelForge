import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { secondsToTicks, type MediaAsset } from "@reelforge/engine";
import type { RpcMethod, RpcMethods } from "@reelforge/shared";
import { startBackend, type BackendHandle } from "../src/server.js";

const sec = secondsToTicks;
let handle: BackendHandle;
let dir: string;
let base: string;
let token: string;

/** Minimal typed RPC client over the real HTTP bridge. */
async function rpc<M extends RpcMethod>(method: M, params: RpcMethods[M]["req"]): Promise<RpcMethods[M]["res"]> {
  const r = await fetch(`${base}/rpc`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-reelforge-token": token },
    body: JSON.stringify({ method, params }),
  });
  const body = (await r.json()) as any;
  if (!body.ok) throw new Error(`${body.error.code}: ${body.error.message}`);
  return body.result;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "reelforge-be-"));
  process.env.REELFORGE_STATE_FILE = join(dir, "bridge.json");
  handle = await startBackend({ dbFile: join(dir, "db.sqlite"), publishState: true });
  base = `http://127.0.0.1:${handle.bridge.port}`;
  token = handle.bridge.token;
});

afterAll(async () => {
  await handle.stop();
  await rm(dir, { recursive: true, force: true });
});

const fakeVideo = (id: string): MediaAsset => ({
  id,
  kind: "video",
  path: `/virtual/${id}.mp4`,
  name: `${id}.mp4`,
  importedAt: "2026-01-01T00:00:00.000Z",
  durationTicks: sec(10),
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  probeStatus: "ready",
});

describe("backend bridge integration", () => {
  let projectId: string;
  let videoTrackId: string;

  it("rejects requests without a token", async () => {
    const r = await fetch(`${base}/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "editor.status", params: {} }),
    });
    expect(r.status).toBe(401);
  });

  it("reports editor status", async () => {
    const status = await rpc("editor.status", {});
    expect(status.app).toBe("ReelForge");
    expect(status).toHaveProperty("ffmpeg");
  });

  it("creates a project and lists it", async () => {
    const created = await rpc("project.create", { name: "Reel A", aspect: "9:16", fps: 30 });
    projectId = created.projectId;
    expect(created.doc.name).toBe("Reel A");
    videoTrackId = created.doc.timeline.tracks.find((t) => t.kind === "video")!.id;
    const list = await rpc("project.list", {});
    expect(list.projects.some((p) => p.id === projectId)).toBe(true);
  });

  it("edits the timeline through project.command (the agent path)", async () => {
    await rpc("project.command", { projectId, command: { type: "addMedia", params: { asset: fakeVideo("v1") } } });
    const add = await rpc("project.command", {
      projectId,
      command: { type: "addClip", params: { trackId: videoTrackId, kind: "video", mediaId: "v1", startTick: 0, durationTick: sec(5) } },
      source: "agent",
    });
    const clipId = add.created!.clipId!;
    expect(add.doc.timeline.durationTicks).toBe(sec(5));

    await rpc("project.command", { projectId, command: { type: "trimClip", params: { clipId, edge: "end", toTick: sec(3) } } });
    const trimmed = await rpc("project.details", { projectId });
    expect(trimmed.doc.timeline.durationTicks).toBe(sec(3));
  });

  it("undo/redo work over the bridge", async () => {
    const undone = await rpc("project.undo", { projectId });
    expect(undone.doc.timeline.durationTicks).toBe(sec(5));
    const redone = await rpc("project.redo", { projectId });
    expect(redone.doc.timeline.durationTicks).toBe(sec(3));
  });

  it("records activity including the agent-sourced edit", async () => {
    const details = await rpc("project.details", { projectId });
    const sources = details.activity.map((a) => a.source);
    expect(sources).toContain("agent");
    expect(details.activity.some((a) => a.label === "Add clip")).toBe(true);
  });

  it("persists across a daemon restart (crash recovery)", async () => {
    await rpc("project.save", { projectId });
    await handle.stop();
    // Reopen a fresh backend against the same DB file.
    handle = await startBackend({ dbFile: join(dir, "db.sqlite"), publishState: true });
    base = `http://127.0.0.1:${handle.bridge.port}`;
    token = handle.bridge.token;
    const reopened = await rpc("project.open", { projectId });
    expect(reopened.doc.name).toBe("Reel A");
    expect(reopened.doc.timeline.durationTicks).toBe(sec(3));
    expect(reopened.doc.media).toHaveLength(1);
  });
});
