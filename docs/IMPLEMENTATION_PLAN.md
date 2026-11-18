# ReelForge — Implementation Plan

> Ordering is chosen so the hardest-to-fake, most-testable, highest-value parts land
> first, and so each phase leaves the repo in a working state (engineering rule #15).

## Phase 1 — Foundation
Workspace, tsconfig, lint, docs, `@reelforge/shared` (bridge protocol + shared zod types).
**Exit:** `pnpm install` + `pnpm typecheck` clean.

## Phase 2 — Engine core (`@reelforge/engine`) — *no I/O, pure*
Time model (rational ticks) · project document · tracks/clips · editing commands with
invert-based undo/redo · versioned schema + migrations.
**Exit:** `pnpm --filter @reelforge/engine test` green with high coverage on operations
and undo/redo round-trips.

## Phase 3 — Media engine (`@reelforge/media`)
Runtime FFmpeg/FFprobe detection (PATH → bundled vendor dir → explicit config). Probe
metadata, thumbnails, proxy generation, waveform peaks, scene-change detection, and the
**timeline→filtergraph compiler** for export. FFprobe-based output validation.
**Exit:** probe + a 2-clip concat export verified by FFprobe on a programmatically
generated test asset (skipped with a clear message when FFmpeg is absent).

## Phase 4 — Backend daemon (`@reelforge/backend`)
Authoritative project state, SQLite persistence (`node:sqlite` behind a `Database` port),
local bridge: HTTP command endpoint + WS event stream, loopback-only + session token,
job queue (analyze/render/export) with progress + cancel, debounced autosave, crash
recovery.
**Exit:** integration test drives a full project lifecycle over the bridge.

## Phase 5 — MCP server (`@reelforge/mcp`)
`reelforge-mcp` stdio server using `@modelcontextprotocol/sdk`. Every tool from the spec,
zod-validated, structured responses, read-only vs mutating classification, activity log.
**Exit:** a real MCP client (SDK in-memory/stdio transport) lists tools and executes a
create-project → import → add-clip → trim → export flow against a live backend.

## Phase 6 — Desktop UI (`apps/desktop`)
Tauri 2 shell (thin Rust: paths, dialogs, spawn backend). React workspace: media library,
preview, multi-track timeline (drag/trim/split/snap/zoom/waveforms/thumbnails), inspector,
AI activity panel, export screen, settings, home dashboard. Bridge client + live WS sync.
**Exit:** manual Workflow A (import→edit→caption→audio→preview→export→reopen) works in dev.

## Phase 7 — AI editing features
Scene analysis & keyframe extraction, opt-in local transcription (whisper.cpp) with model
download consent, caption styles + rendering (ASS/libass via FFmpeg), auto-edit pipeline
(silence removal, pacing, transitions, ducking, color), text/title animation.

## Phase 8 — REA integration (developer workflow, optional for end users)
Clone + document REA; wire it to Claude Code / OpenCode per its real docs; record the
reference-analysis workflow for studying editor UX. Kept out of the shipped product.

## Phase 9 — Packaging, CI, release
Tauri bundlers (Windows NSIS/MSI, macOS .app + DMG), GitHub Actions matrix (build Windows
on windows runners, macOS on macos runners), optional signing/notarization via secrets,
FFmpeg redistribution handled per license, third-party notices, release notes.

## Cross-cutting, every phase
Types everywhere · error handling with typed results · structured logging · tests before
moving on · STATUS.md kept current · no dead controls, no simulated output.
