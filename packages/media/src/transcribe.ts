/**
 * Local speech-to-text via whisper.cpp (fully offline, no API key, cross-platform).
 *
 * Chosen over cloud voice-typing tools because ReelForge requires: local-by-default
 * processing, no mandatory cloud/account, no hardcoded keys, and segment/phrase timestamps
 * for caption timing. whisper.cpp provides all of these.
 *
 * Detection order for the binary: REELFORGE_WHISPER env → `whisper-cli` → `whisper` →
 * `main` on PATH. Model: REELFORGE_WHISPER_MODEL env → a .bin in the models cache dir.
 * Models are downloaded only with explicit user consent (see downloadWhisperModel).
 */

import { spawn } from "node:child_process";
import { accessSync, constants, createWriteStream, existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { secondsToTicks, type Ticks } from "@reelforge/engine";
import { FfmpegNotFoundError, runCapture, type FfmpegTools } from "./ffmpeg.js";

export interface TranscriptSegment {
  startTick: Ticks;
  endTick: Ticks;
  text: string;
}
export interface WordTiming {
  startTick: Ticks;
  endTick: Ticks;
  text: string;
}
export interface Transcript {
  language?: string;
  segments: TranscriptSegment[];
  /** Word-level timings when the backend/mode provides them (for karaoke captions). */
  words?: WordTiming[];
}

export type SttProvider =
  | { kind: "local"; whisper: WhisperTools; wordLevel?: boolean; language?: string }
  | { kind: "groq"; apiKey: string; model?: string; wordLevel?: boolean; language?: string };

export interface WhisperTools {
  bin: string | null;
  model: string | null;
}

const isWindows = process.platform === "win32";
const exe = (n: string) => (isWindows ? `${n}.exe` : n);

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    const c = join(dir, exe(name));
    try {
      accessSync(c, constants.X_OK);
      return c;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/** Find a whisper binary in an install dir (checks common names). */
function binInDir(dir: string): string | null {
  for (const name of ["whisper-cli", "whisper", "main"]) {
    for (const sub of ["", "Release", "bin", "build/bin"]) {
      const c = join(dir, sub, exe(name));
      try {
        accessSync(c, constants.X_OK);
        return c;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

export function detectWhisper(modelsDir?: string, binDir?: string): WhisperTools {
  const bin =
    process.env.REELFORGE_WHISPER ??
    (binDir ? binInDir(binDir) : null) ??
    onPath("whisper-cli") ??
    onPath("whisper") ??
    onPath("main");
  let model = process.env.REELFORGE_WHISPER_MODEL ?? null;
  for (const dir of [modelsDir, binDir]) {
    if (!model && dir && existsSync(dir)) {
      const bins = readdirSync(dir).filter((f) => f.endsWith(".bin"));
      if (bins.length) model = join(dir, bins.sort()[0]!);
    }
  }
  return { bin, model };
}

/**
 * Parse whisper.cpp `-oj` JSON (pure, unit-tested). Accepts the standard shape with a
 * `transcription` array whose entries carry `offsets.{from,to}` in milliseconds and `text`.
 */
export function parseWhisperJson(json: unknown): Transcript {
  const obj = json as {
    result?: { language?: string };
    transcription?: { offsets?: { from: number; to: number }; text?: string }[];
  };
  const segments: TranscriptSegment[] = [];
  for (const seg of obj.transcription ?? []) {
    if (!seg.offsets) continue;
    const text = (seg.text ?? "").trim();
    if (!text) continue;
    segments.push({
      startTick: secondsToTicks(seg.offsets.from / 1000),
      endTick: secondsToTicks(seg.offsets.to / 1000),
      text,
    });
  }
  return { language: obj.result?.language, segments };
}

/** Extract 16 kHz mono WAV (whisper's expected input) from any media. */
export async function extractWav(tools: FfmpegTools, src: string, out: string): Promise<void> {
  if (!tools.ffmpeg) throw new FfmpegNotFoundError("ffmpeg");
  await runCapture(
    tools.ffmpeg,
    ["-y", "-hide_banner", "-i", src, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", out],
    { timeoutMs: 120_000 },
  );
}

/** Extract a compact 16 kHz mono MP3 (for cloud upload). */
export async function extractMp3(tools: FfmpegTools, src: string, out: string): Promise<void> {
  if (!tools.ffmpeg) throw new FfmpegNotFoundError("ffmpeg");
  await runCapture(
    tools.ffmpeg,
    ["-y", "-hide_banner", "-i", src, "-ar", "16000", "-ac", "1", "-b:a", "64k", out],
    { timeoutMs: 120_000 },
  );
}

export class WhisperNotAvailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WhisperNotAvailableError";
  }
}

/** Transcribe a media file to timed segments using whisper.cpp. */
export async function transcribe(
  src: string,
  ff: FfmpegTools,
  whisper: WhisperTools,
  opts: { threads?: number; language?: string; wordLevel?: boolean } = {},
): Promise<Transcript> {
  if (!whisper.bin) {
    throw new WhisperNotAvailableError(
      "whisper.cpp not found. Install it (e.g. `whisper-cli`) and a ggml model, or set REELFORGE_WHISPER / REELFORGE_WHISPER_MODEL.",
    );
  }
  if (!whisper.model) {
    throw new WhisperNotAvailableError("No whisper model found. Download a ggml model (see downloadWhisperModel).");
  }
  const work = join(tmpdir(), `reelforge-stt-${randomUUID()}`);
  await mkdir(work, { recursive: true });
  const wav = join(work, "audio.wav");
  const outBase = join(work, "out");
  try {
    await extractWav(ff, src, wav);
    const args = ["-m", whisper.model, "-f", wav, "-oj", "-of", outBase, "-t", String(opts.threads ?? 4)];
    // Word-level: split on word with max-len 1 so each segment is a single word (+timings).
    if (opts.wordLevel) args.push("-ml", "1", "-sow");
    if (opts.language) args.push("-l", opts.language);
    await runProcess(whisper.bin, args, 1_800_000);
    const jsonText = await readFile(`${outBase}.json`, "utf8");
    const t = parseWhisperJson(JSON.parse(jsonText));
    if (opts.wordLevel) t.words = t.segments.map((s) => ({ ...s })); // each segment is a word
    return t;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

// ---- Groq cloud backend (optional; used when GROQ_API_KEY/config is present) ----

interface GroqVerbose {
  language?: string;
  segments?: { start: number; end: number; text: string }[];
  words?: { word: string; start: number; end: number }[];
  text?: string;
}

/** Parse Groq (OpenAI-compatible) verbose_json into a Transcript (pure, unit-tested). */
export function parseGroqVerboseJson(json: unknown): Transcript {
  const g = json as GroqVerbose;
  const segments: TranscriptSegment[] = (g.segments ?? [])
    .map((s) => ({ startTick: secondsToTicks(s.start), endTick: secondsToTicks(s.end), text: (s.text ?? "").trim() }))
    .filter((s) => s.text);
  const words: WordTiming[] = (g.words ?? [])
    .map((w) => ({ startTick: secondsToTicks(w.start), endTick: secondsToTicks(w.end), text: (w.word ?? "").trim() }))
    .filter((w) => w.text);
  if (segments.length === 0 && g.text) {
    segments.push({ startTick: 0, endTick: secondsToTicks((g.words?.at(-1)?.end ?? 0) || 0), text: g.text.trim() });
  }
  return { language: g.language, segments, words: words.length ? words : undefined };
}

export const GROQ_STT_ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";
export const GROQ_DEFAULT_MODEL = "whisper-large-v3-turbo";

/** Transcribe via Groq's cloud API. Requires an API key (never hardcoded). */
export async function transcribeGroq(
  src: string,
  ff: FfmpegTools,
  opts: { apiKey: string; model?: string; language?: string; wordLevel?: boolean },
): Promise<Transcript> {
  if (!opts.apiKey) throw new Error("Groq API key required (set GROQ_API_KEY).");
  const work = join(tmpdir(), `reelforge-groq-${randomUUID()}`);
  await mkdir(work, { recursive: true });
  const mp3 = join(work, "audio.mp3");
  try {
    await extractMp3(ff, src, mp3);
    const bytes = await readFile(mp3);
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: "audio/mpeg" }), "audio.mp3");
    form.set("model", opts.model ?? GROQ_DEFAULT_MODEL);
    form.set("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    if (opts.wordLevel) form.append("timestamp_granularities[]", "word");
    if (opts.language) form.set("language", opts.language);
    const res = await fetch(GROQ_STT_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Groq transcription failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
    return parseGroqVerboseJson(await res.json());
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Unified entry point: transcribe with whichever provider is configured. */
export function runTranscription(src: string, ff: FfmpegTools, provider: SttProvider): Promise<Transcript> {
  if (provider.kind === "groq") {
    return transcribeGroq(src, ff, { apiKey: provider.apiKey, model: provider.model, language: provider.language, wordLevel: provider.wordLevel });
  }
  return transcribe(src, ff, provider.whisper, { language: provider.language, wordLevel: provider.wordLevel });
}

function runProcess(bin: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out`));
    }, timeoutMs);
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${bin} exited ${code}: ${stderr.slice(-1000)}`));
    });
  });
}

/**
 * One-click: download a prebuilt whisper.cpp binary for the current platform into destDir
 * and return the resolved binary path. Windows/Linux have official prebuilt assets; macOS
 * has none in the release, so callers are told to `brew install whisper-cpp`.
 */
export async function downloadWhisperBinary(
  destDir: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const TAG = "v1.9.2";
  let asset: string;
  if (process.platform === "win32" && process.arch === "x64") asset = "whisper-bin-x64.zip";
  else if (process.platform === "linux" && process.arch === "x64") asset = "whisper-bin-ubuntu-x64.tar.gz";
  else {
    throw new WhisperNotAvailableError(
      process.platform === "darwin"
        ? "No prebuilt whisper.cpp for macOS. Install it with `brew install whisper-cpp` (provides whisper-cli)."
        : `No prebuilt whisper.cpp for ${process.platform}/${process.arch}. Build whisper.cpp and set REELFORGE_WHISPER.`,
    );
  }
  await mkdir(destDir, { recursive: true });
  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${TAG}/${asset}`;
  const archive = join(destDir, asset);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`whisper binary download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  const file = createWriteStream(archive);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    file.write(value);
    if (total && onProgress) onProgress(received / total);
  }
  await new Promise<void>((resolve, reject) => file.end((e?: Error | null) => (e ? reject(e) : resolve())));
  // Extract. On Windows use the bundled bsdtar (System32\tar.exe), which handles .zip
  // regardless of PATH order; on Linux GNU tar handles .tar.gz.
  if (process.platform === "win32") {
    const sysTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    await runProcess(sysTar, ["-xf", archive, "-C", destDir], 120_000);
  } else {
    await runProcess("tar", ["-xzf", archive, "-C", destDir], 120_000);
  }
  const bin = binInDir(destDir);
  if (!bin) throw new Error("whisper binary not found after extraction");
  return bin;
}

export const WHISPER_MODELS = ["tiny.en", "base.en", "small.en", "tiny", "base", "small"] as const;
export type WhisperModelName = (typeof WHISPER_MODELS)[number];

/**
 * Download a ggml whisper model (only call after explicit user consent). Pulls from the
 * official whisper.cpp model repository on Hugging Face.
 */
export async function downloadWhisperModel(
  name: WhisperModelName,
  destDir: string,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  await mkdir(destDir, { recursive: true });
  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${name}.bin`;
  const dest = join(destDir, `ggml-${name}.bin`);
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`model download failed: HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let received = 0;
  const file = createWriteStream(dest);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    file.write(value);
    if (total && onProgress) onProgress(received / total);
  }
  await new Promise<void>((resolve, reject) => file.end((err?: Error | null) => (err ? reject(err) : resolve())));
  return dest;
}
