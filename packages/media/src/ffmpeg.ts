/**
 * FFmpeg / FFprobe discovery and process execution.
 *
 * Resolution order for each binary:
 *   1. Explicit path passed in / env (REELFORGE_FFMPEG, REELFORGE_FFPROBE)
 *   2. A bundled binary under a vendor directory (set by the installer), if present
 *   3. The system PATH
 *
 * Nothing here assumes a binary exists; callers check `detectFfmpeg()` first and surface a
 * clear "FFmpeg not found" error rather than faking output.
 */

import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export interface FfmpegTools {
  ffmpeg: string | null;
  ffprobe: string | null;
  ffmpegVersion?: string;
  ffprobeVersion?: string;
}

export interface DetectOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  vendorDir?: string;
}

const isWindows = process.platform === "win32";
const exe = (name: string) => (isWindows ? `${name}.exe` : name);

function existsOnPath(bin: string): string | null {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of paths) {
    const candidate = join(dir, exe(bin));
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

function resolveBinary(
  name: "ffmpeg" | "ffprobe",
  explicit: string | undefined,
  envVar: string,
  vendorDir?: string,
): string | null {
  const fromEnv = explicit ?? process.env[envVar];
  if (fromEnv) return fromEnv;
  if (vendorDir) {
    const candidate = join(vendorDir, exe(name));
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* fall through to PATH */
    }
  }
  return existsOnPath(name);
}

export async function detectFfmpeg(opts: DetectOptions = {}): Promise<FfmpegTools> {
  const ffmpeg = resolveBinary("ffmpeg", opts.ffmpegPath, "REELFORGE_FFMPEG", opts.vendorDir);
  const ffprobe = resolveBinary("ffprobe", opts.ffprobePath, "REELFORGE_FFPROBE", opts.vendorDir);
  const tools: FfmpegTools = { ffmpeg, ffprobe };
  if (ffmpeg) tools.ffmpegVersion = await probeVersion(ffmpeg);
  if (ffprobe) tools.ffprobeVersion = await probeVersion(ffprobe);
  return tools;
}

async function probeVersion(bin: string): Promise<string | undefined> {
  try {
    const { stdout } = await runCapture(bin, ["-version"], { timeoutMs: 5000 });
    const first = stdout.split(/\r?\n/)[0] ?? "";
    const m = first.match(/version\s+(\S+)/i);
    return m?.[1] ?? (first.trim() || undefined);
  } catch {
    return undefined;
  }
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called with each stderr chunk (FFmpeg writes progress to stderr). */
  onStderr?: (chunk: string) => void;
}

/** Run a process and capture full stdout/stderr. Rejects on non-zero exit. */
export async function runCapture(
  bin: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  const res = await runRaw(bin, args, opts);
  if (res.code !== 0) {
    throw new Error(
      `${bin} exited with code ${res.code}: ${res.stderr.slice(-2000) || res.stdout.slice(-2000)}`,
    );
  }
  return res;
}

/** Run a process, resolving regardless of exit code. */
export function runRaw(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      cleanup();
      reject(new Error("aborted"));
    };
    if (opts.signal) {
      if (opts.signal.aborted) {
        child.kill("SIGKILL");
        return reject(new Error("aborted"));
      }
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
        cleanup();
        reject(new Error(`${bin} timed out after ${opts.timeoutMs}ms`));
      }, opts.timeoutMs);
    }

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      opts.onStderr?.(s);
    });
    child.on("error", (err) => {
      cleanup();
      reject(err);
    });
    child.on("close", (code) => {
      cleanup();
      resolve({ code, stdout, stderr });
    });
  });
}

export class FfmpegNotFoundError extends Error {
  constructor(which: "ffmpeg" | "ffprobe") {
    super(
      `${which} not found. Install FFmpeg and ensure it is on PATH, or set REELFORGE_${which.toUpperCase()}.`,
    );
    this.name = "FfmpegNotFoundError";
  }
}
