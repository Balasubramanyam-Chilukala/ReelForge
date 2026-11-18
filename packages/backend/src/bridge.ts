/**
 * Local bridge: HTTP POST /rpc for request/response and a WebSocket channel for pushed
 * events. Binds to 127.0.0.1 only and requires the per-session token. This is never
 * exposed publicly.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import type { BridgeEvent } from "@reelforge/shared";
import type { RpcMethod } from "@reelforge/shared";
import { ProjectService, ServiceError } from "./service.js";

export interface BridgeOptions {
  host?: string;
  port?: number;
  token?: string;
}

export interface StartedBridge {
  server: Server;
  port: number;
  token: string;
  close: () => Promise<void>;
  broadcast: (event: BridgeEvent) => void;
}

const HOST = "127.0.0.1";

export async function startBridge(service: ProjectService, opts: BridgeOptions = {}): Promise<StartedBridge> {
  const token = opts.token ?? randomBytes(24).toString("hex");
  const clients = new Set<WebSocket>();

  const broadcast = (event: BridgeEvent) => {
    const data = JSON.stringify(event);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(data);
    }
  };

  const server = createServer((req, res) => void handleHttp(req, res, service, token));

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    if (!checkToken(req, token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      clients.add(ws);
      ws.on("close", () => clients.delete(ws));
      ws.send(JSON.stringify({ type: "hello", app: "ReelForge", version: service.status().version } satisfies BridgeEvent));
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, opts.host ?? HOST, () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  return {
    server,
    port,
    token,
    broadcast,
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of clients) ws.close();
        wss.close();
        server.close(() => resolve());
      }),
  };
}

function checkToken(req: IncomingMessage, token: string): boolean {
  const header = req.headers["x-reelforge-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  const url = new URL(req.url ?? "/", "http://localhost");
  const q = url.searchParams.get("token");
  const candidate = provided ?? q ?? "";
  const a = Buffer.from(candidate);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readBody(req: IncomingMessage, limit = 50 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  service: ProjectService,
  token: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, app: "ReelForge" });
  }
  if (!checkToken(req, token)) {
    return json(res, 401, { ok: false, error: { code: "UNAUTHORIZED", message: "invalid or missing token" } });
  }
  if (req.method !== "POST" || url.pathname !== "/rpc") {
    return json(res, 404, { ok: false, error: { code: "NOT_FOUND", message: "unknown endpoint" } });
  }
  let envelope: { method: RpcMethod; params: unknown };
  try {
    envelope = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { ok: false, error: { code: "BAD_JSON", message: "invalid JSON body" } });
  }
  try {
    const result = await dispatch(service, envelope.method, envelope.params);
    return json(res, 200, { ok: true, result });
  } catch (err) {
    const code = err instanceof ServiceError ? err.code : (err as any)?.code ?? "ERROR";
    return json(res, 200, { ok: false, error: { code: String(code), message: (err as Error).message } });
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) });
  res.end(data);
}

/** Map RPC method names to service calls. One place; no business logic here. */
export async function dispatch(service: ProjectService, method: RpcMethod, params: any): Promise<unknown> {
  switch (method) {
    case "editor.status":
      return service.status();
    case "project.list":
      return { projects: service.listProjects() };
    case "project.create":
      return service.createProject(params ?? {});
    case "project.open":
      return { doc: service.openProject(params.projectId) };
    case "project.save":
      return service.saveProject(params.projectId);
    case "project.details":
      return service.details(params.projectId);
    case "project.command":
      return service.applyCommand(params.projectId, params.command, params.source ?? "user");
    case "project.undo":
      return service.undo(params.projectId);
    case "project.redo":
      return service.redo(params.projectId);
    case "media.import":
      return service.importMedia(params.projectId, params.path, params.probe ?? true);
    case "media.list":
      return { media: service.listMedia(params.projectId) };
    case "media.metadata":
      return { asset: service.mediaMetadata(params.projectId, params.mediaId) };
    case "media.analyze":
      return service.analyze(params.projectId, params.mediaId);
    case "media.scenes":
      return { scenes: await service.detectScenes(params.projectId, params.mediaId, params.threshold) };
    case "media.keyframes":
      return service.extractKeyframes(params.projectId, params.mediaId, params.everySec);
    case "media.contactSheet":
      return service.contactSheet(params.projectId, params.mediaId);
    case "media.transcript":
      return { transcript: await service.transcript(params.projectId, params.mediaId, params.language, params.wordLevel) };
    case "media.silence":
      return { segments: await service.detectSilence(params.projectId, params.mediaId) };
    case "captions.generate":
      return service.generateCaptions(params.projectId, params.mediaId, {
        preset: params.preset,
        trackId: params.trackId,
        language: params.language,
        maxChars: params.maxChars,
        mode: params.mode,
        groupSize: params.groupSize,
        animation: params.animation,
      });
    case "edit.autoRoughCut":
      return service.autoRoughCut(params.projectId, params.mediaIds, {
        targetSeconds: params.targetSeconds,
        removeSilence: params.removeSilence,
        maxClipSeconds: params.maxClipSeconds,
      });
    case "edit.autoReframe":
      return service.autoReframe(params.projectId, params.fit);
    case "edit.punchIn":
      return service.autoPunchIn(params.projectId, params.scale);
    case "whisper.status":
      return service.whisperStatus();
    case "whisper.download":
      return service.downloadWhisperModel(params.model);
    case "whisper.setup":
      return service.setupTranscription(params.model);
    case "preview.frame":
      return service.previewFrame(params.projectId, params.atTick);
    case "export.start":
      return { jobId: service.startExport(params.projectId, params.outputPath, params.encode, params.overwrite, params.normalizeLoudness) };
    case "export.status":
      return { job: service.exportStatus(params.jobId) };
    case "job.list":
      return { jobs: service.jobs.list() };
    case "job.cancel":
      return { ok: service.jobs.cancel(params.jobId) };
    default:
      throw new ServiceError("UNKNOWN_METHOD", `unknown method: ${method}`);
  }
}
