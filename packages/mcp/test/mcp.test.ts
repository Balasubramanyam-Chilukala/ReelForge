import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { detectFfmpeg } from "@reelforge/media";
import { startBackend, type BackendHandle } from "@reelforge/backend";
import { BridgeClient } from "../src/client.js";
import { createMcpServer } from "../src/server.js";

const execFileP = promisify(execFile);

let handle: BackendHandle;
let dir: string;
let client: Client;

/** Call a tool and parse the JSON text payload our tools return. */
async function call(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const res: any = await client.callTool({ name, arguments: args });
  const text = res.content?.[0]?.text ?? "";
  if (res.isError) throw new Error(`tool ${name} error: ${text}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "reelforge-mcp-"));
  process.env.REELFORGE_STATE_FILE = join(dir, "bridge.json");
  handle = await startBackend({ dbFile: join(dir, "db.sqlite"), publishState: true });

  const bridgeClient = new BridgeClient({ port: handle.bridge.port, token: handle.bridge.token });
  const server = createMcpServer(bridgeClient);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await handle.stop();
  await rm(dir, { recursive: true, force: true });
});

describe("reelforge-mcp via a real MCP client", () => {
  it("advertises the full tool surface", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const expected of [
      "get_editor_status", "list_projects", "create_project", "open_project", "save_project", "get_project_details",
      "import_media", "list_media", "get_media_metadata", "analyze_media", "extract_keyframes", "generate_contact_sheet", "get_transcript", "detect_scenes",
      "get_timeline", "create_timeline", "add_clip", "remove_clip", "trim_clip", "split_clip", "move_clip", "reorder_clips", "set_clip_speed", "set_clip_transform", "add_transition",
      "generate_captions", "edit_caption", "style_captions", "add_text_overlay", "animate_text",
      "add_audio_track", "adjust_audio", "set_audio_fade", "apply_audio_ducking", "apply_color_adjustment", "apply_effect",
      "render_preview", "capture_preview_frame", "export_video", "get_export_status",
      "undo", "redo",
    ]) {
      expect(names, `missing tool ${expected}`).toContain(expected);
    }
  });

  it("validates tool parameters (bad args rejected)", async () => {
    // create_project with an invalid aspect enum must be rejected by schema validation.
    await expect(
      client.callTool({ name: "create_project", arguments: { aspect: "banana" } }),
    ).rejects.toThrow(/Invalid enum value|aspect/i);
  });

  it("runs an end-to-end edit flow: create → import → add → trim → text → undo/redo", async () => {
    const status = await call("get_editor_status");
    expect(status.app).toBe("ReelForge");

    const created = await call("create_project", { name: "Agent Reel", aspect: "9:16", fps: 30 });
    const projectId = created.projectId as string;

    // Import without probe (no ffmpeg needed) — a pending-probe asset is still editable.
    const imported = await call("import_media", { projectId, path: "/virtual/clip.mp4", probe: false });
    const mediaId = imported.mediaId as string;

    const timeline = await call("get_timeline", { projectId });
    const videoTrack = timeline.tracks.find((t: any) => t.kind === "video").id;

    const added = await call("add_clip", { projectId, trackId: videoTrack, kind: "video", mediaId, startTick: 0, durationTick: 150_000 });
    const clipId = added.created.clipId as string;
    expect(added.doc.timeline.durationTicks).toBe(150_000);

    const trimmed = await call("trim_clip", { projectId, clipId, edge: "end", toTick: 90_000 });
    expect(trimmed.doc.timeline.durationTicks).toBe(90_000);

    // Add a styled caption (auto-creates a text track).
    const caption = await call("add_text_overlay", { projectId, startTick: 0, durationTick: 60_000, text: "Big news", preset: "bold", anchorY: 0.85 });
    expect(caption.created.clipId).toBeTruthy();

    // History
    const undone = await call("undo", { projectId });
    expect(undone.canRedo).toBe(true);
    await call("redo", { projectId });

    // Activity recorded the agent as the source.
    const details = await call("get_project_details", { projectId });
    expect(details.activity.some((a: any) => a.source === "agent")).toBe(true);
  });

  it("export_video returns a jobId and reports status (requires FFmpeg to finish)", async () => {
    const status = await call("get_editor_status");
    const created = await call("create_project", { name: "Export Reel" });
    const projectId = created.projectId as string;

    if (!status.ffmpeg.ffmpeg) {
      // Without FFmpeg, export must fail clearly (not fake success).
      const res: any = await client.callTool({ name: "export_video", arguments: { projectId, outputPath: join(dir, "out.mp4") } });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toMatch(/ffmpeg/i);
      return;
    }

    // With FFmpeg: synthesize a short source, then real import + edit + export.
    const tools = await detectFfmpeg();
    const srcVideo = join(dir, "src.mp4");
    await execFileP(tools.ffmpeg!, [
      "-y", "-hide_banner", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-c:a", "aac", "-shortest", srcVideo,
    ]);
    const imp = await call("import_media", { projectId, path: srcVideo, probe: true });
    const timeline = await call("get_timeline", { projectId });
    const vt = timeline.tracks.find((t: any) => t.kind === "video").id;
    await call("add_clip", { projectId, trackId: vt, kind: "video", mediaId: imp.mediaId, startTick: 0, durationTick: 60_000 });

    const out = join(dir, "agent-export.mp4");
    const { jobId } = await call("export_video", { projectId, outputPath: out, preset: "ultrafast", crf: 30 });
    let job: any;
    for (let i = 0; i < 120; i++) {
      job = (await call("get_export_status", { jobId })).job;
      if (job.status === "done" || job.status === "error") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(job.status).toBe("done");
    expect(job.result.width).toBe(1080);
  }, 120_000);
});
