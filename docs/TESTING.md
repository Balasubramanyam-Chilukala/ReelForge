# ReelForge — Testing

## Test layers
1. **Engine unit tests** (vitest, `packages/engine`) — pure model + every editing command
   + undo/redo round-trips + migrations. No I/O, fast, deterministic. This is the primary
   correctness net for all editing logic.
2. **Media tests** (`packages/media`) — ffprobe parsing, filtergraph compilation (string
   assertions, no ffmpeg needed) + end-to-end probe/export against a programmatically
   generated asset (auto-skipped with a clear message when FFmpeg is not on PATH).
3. **Backend integration** (`packages/backend`) — drive the bridge: create project, import,
   edit, save, reopen, export job lifecycle.
4. **MCP protocol tests** (`packages/mcp`) — a *real* MCP client over the SDK transport
   lists tools, validates schemas, and runs an edit→export flow. Not just mocked handlers.
5. **Cross-platform CI** — GitHub Actions matrix (windows + macos) runs 1–4, builds assets
   with FFmpeg, and verifies exports with FFprobe (duration/codec/resolution/fps/audio).
   Tests include paths with spaces and non-ASCII characters.

## Running
```
pnpm install
pnpm typecheck
pnpm test                       # all package tests
pnpm --filter @reelforge/engine test
```

## Generating test assets without copyrighted media
`packages/media/test/assets.ts` uses FFmpeg's `testsrc`/`sine` lavfi sources to synthesize
short color-bar + tone clips at chosen resolutions/fps, so tests never ship real footage.

## Current state (82 automated tests, all green)
- engine 35, media 25, backend 10, mcp 4, agent-setup 8.
- Real FFmpeg renders validated by FFprobe, including a **cross-dissolve transition + audio
  ducking** graph and a trimmed 2-clip export.
- whisper.cpp `-oj` parser, `silencedetect` parser, and the caption source→timeline mapping
  are unit-tested (pure); live transcription needs a whisper.cpp binary + model.
- A **shipped-binary** run (bundled daemon + bundled `reelforge-mcp` over stdio, 46 tools)
  drives create→import→edit→caption→export to a validated 1080×1920 MP4.
See `STATUS.md` → "What is tested right now".
