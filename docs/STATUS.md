# ReelForge — Build Status (resumable checkpoint)

**Last updated:** 2026-11-18
**Current phase:** Core complete (Phases 1–6, 8) + packaging configured (Phase 9). 67 automated
tests green; shipped-binary end-to-end agent→export proven.

## Test tally (all green)
engine 36 · media 33 · backend 14 · mcp 4 · agent-setup 8 = **95 tests**. Plus shipped-binary
runs (bundled daemon + bundled `reelforge-mcp` over stdio, **50 tools** → validated MP4), a
built **Tauri Windows installer**, and live proofs: whisper.cpp transcription,
**word-by-word karaoke captions** (16 word clips with timing), transition + ducking render,
visual-effects render, and reframe + punch-in + loudness-normalized export.

## Trending feature set (this build)
- Word-by-word / karaoke captions (word-level timing via whisper `-ml 1 -sow` or Groq words)
- **Groq** cloud transcription (whisper-large-v3-turbo) when `GROQ_API_KEY` is set; local
  whisper.cpp is the offline default; `setup_transcription` one-click installs the local binary+model
- Auto-reframe to fill 9:16 (cover, no black bars); auto punch-in zoom
- Loudness normalization (-14 LUFS) on export; real cross-dissolve/slide; named visual effects
- Auto rough-cut (silence removal) + scene/keyframe analysis

This file is the single source of truth for "where are we." Update it at the end of every
work session so the build can resume from the exact last completed checkpoint.

## Legend
✅ done & tested · 🟡 in progress · ⬜ not started · ⛔ blocked (reason)

## Environment (dev machine, verified 2026-11-17)
- Node v24.13, pnpm 12.3, git, Python 3.13, Claude Code CLI 2.1.168 — present
- Rust/Cargo — **absent**. Needed only to *build/package* the Tauri desktop app.
- FFmpeg/FFprobe — **absent**. Needed for media probe/thumbnail/export. Engine core does
  not need it; media + backend render paths are gated behind runtime detection.

## Phase checklist

### Phase 1 — Foundation
- ✅ Repo + pnpm workspace + tsconfig base + .gitignore + git init
- ✅ Docs skeleton (ARCHITECTURE, IMPLEMENTATION_PLAN, STATUS, TESTING, AGENT_INTEGRATION)
- ✅ THIRD_PARTY_NOTICES.md
- 🟡 `@reelforge/shared` protocol/types package
- ⬜ Desktop app shell (Tauri 2 + React + Vite) — blocked on Rust for packaging only

### Phase 2 — Engine core (`@reelforge/engine`) ✅ (33 tests green, typecheck clean)
- ✅ Rational/frame time model (90k ticks; exact for 24/25/30/50/60 and 29.97)
- ✅ Project document model + versioned schema (v1)
- ✅ Timeline + tracks + clips, with collision + source-bound validation
- ✅ Editing commands: rename/settings/media/track/addClip/removeClip/trim/split/move/
  reorder/speed/transform/color/volume/fades/transition/textOverlay/editText/effect
- ✅ Undo/redo (command invert stack) — proven by mixed-sequence snapshot round-trip
- ✅ Migrations framework + guards

### Phase 3 — Media engine (`@reelforge/media`) ✅ (15 tests; export e2e PROVEN with FFmpeg 9.0.2)
- ✅ FFmpeg/FFprobe runtime detection (env → vendor → PATH) + version
- ✅ ffprobe metadata parsing (video/image/audio, fractional fps)
- ✅ Timeline→FFmpeg filtergraph compiler (canvas-overlay model, pure/testable)
- ✅ Export runner with progress + cancel + **FFprobe output validation**
- ✅ Thumbnails / contact sheet / scene detection / waveform peaks / keyframes (spawners)
- ✅ **End-to-end export verified**: 2 clips → real 1080×1920 H.264/AAC MP4 (ffprobe-checked)
- 🟡 True alpha xfade transitions (currently fade-to-black) — Phase 7
- Note: local FFmpeg at `vendor/ffmpeg/...` (gitignored, dev only; not redistributed)

### Phase 4 — Backend daemon (`@reelforge/backend`) ✅ (7 integration tests green)
- ✅ SQLite persistence (`node:sqlite` behind a `Database` port); projects/activity/exports
- ✅ Local bridge: HTTP `/rpc` + WS events, 127.0.0.1-only, per-session token (401 enforced)
- ✅ Job queue (export) with progress + cancel; autosave on every mutation
- ✅ **Persistence across daemon restart (crash recovery) verified**
- ✅ Activity log distinguishes user vs **agent** sources
- ✅ `reelforge-backend` bin + state-file discovery

### Phase 5 — MCP server (`@reelforge/mcp` → reelforge-mcp) ✅ (4 tests; real MCP client)
- ✅ All 41 spec tools registered, zod-validated, thin adapter over the bridge (no edit logic)
- ✅ Timeline tools route through `project.command` → one engine, shared by both clients
- ✅ Phase-7 tools (generate_captions, ducking, transcript) return explicit "not yet" (no fakes)
- ✅ **Real MCP client (SDK, InMemoryTransport)** drove create→import→add→trim→text→undo
- ✅ **Agent-driven export to a validated 1080×1920 MP4 verified** (with FFmpeg)
- ✅ Param validation rejects bad input; export without FFmpeg errors clearly
- ✅ `reelforge-mcp` stdio bin with backend discovery + health check

### Phase 6 — Desktop UI (`apps/desktop`) ✅ builds (tsc clean, vite build OK)
- ✅ Tauri 2 + React + Vite + Zustand; dark graphite theme
- ✅ Home dashboard, editor workspace (media library / preview / multi-track timeline /
  inspector), AI Agents screen, export screen, settings
- ✅ Timeline: multi-track render, select, scrub, drag-move, trim handles, split, delete,
  zoom, undo/redo — all wired to the live bridge
- ✅ Live preview approximates the timeline (text + clips at playhead); transport
- ✅ Bridge client (HTTP+WS) with live `project.updated` sync + agent/user activity feed
- ✅ Tauri shell: `tauri.conf.json`, Rust `lib.rs` (spawns daemon, `get_bridge_info`),
  capabilities, CSP locked to 127.0.0.1
- ⬜ Not run visually here (no Rust/display); verified by typecheck + `vite build`
- 🟡 Native file dialog uses a prompt fallback in browser dev (Tauri dialog plugin wired)

### Phase 7 — AI editing features ✅
- ✅ Scene detection, keyframe/contact-sheet extraction (media + MCP tools)
- ✅ Caption style presets (7), text overlays, animation field, color/effects commands
- ✅ **Local transcription** (whisper.cpp, offline, no key): detection, model download on
  consent, `-oj` parser (tested), WAV extraction
- ✅ **Auto-caption generation**: transcribe → timed caption clips mapped to timeline
  (honoring trim/speed; mapping unit-tested)
- ✅ **Silence detection** (`silencedetect` parser, tested) + **auto rough-cut** assembly
- ✅ **Real cross-dissolve/slide transitions** (alpha xfade with overlap) replacing the
  fade-to-black approximation; fadeFromBlack/ToBlack as luma fades — **rendered & validated**
- ✅ **Audio ducking** via per-track sidechaincompress — **rendered & validated**
- Chose whisper.cpp over cloud voice-typing tools (local-first, no key, segment timestamps)
- Remaining nicety: word-level (vs segment) caption timing; zoom/wipe/blur transitions
  currently render as cross-dissolve (documented in filtergraph.ts)

### Phase 8 — REA integration ✅ (dev workflow)
- ✅ Cloned `rea-agents` v6.9.0 (MIT) → `tools/rea` (gitignored), license preserved
- ✅ `docs/REA.md`: real `npx rea-agents setup` flow for Claude Code/OpenCode, desktop-app
  analysis docs mapped, honest macOS/native-engine limitation recorded

### Phase 9 — Packaging / CI / release ✅ (Windows installer BUILT on this machine)
- ✅ **Real Windows installer produced**: `target/release/bundle/nsis/ReelForge_0.1.0_x64-setup.exe`
  + `reelforge.exe` (11.7 MB), via `tauri build` with Rust 1.100 (MSVC). App icons generated.
- ✅ Self-contained bundles: `reelforge-backend.bundle.cjs`, `reelforge-mcp.bundle.cjs`
  (run with no node_modules; daemon smoke-tested; MCP proven over stdio)
- ✅ `.github/workflows/ci.yml` (Windows+macOS matrix: build, typecheck, test w/ FFmpeg,
  bundle, frontend build, daemon /health smoke)
- ✅ `.github/workflows/release.yml` (tauri-action, Win NSIS + mac universal .app/.dmg,
  optional Apple signing/notarization via secrets)
- ✅ `docs/BUILD.md` run/install/build/sign instructions; FFmpeg LGPL/GPL policy documented
- ⬜ Signed production builds (needs certs/secrets); macOS .dmg (needs a Mac runner)

## What is tested right now
See the test tally at the top. Highlights proven by automated tests:
- Every clip operation + undo/redo round-trips (engine).
- Real FFmpeg export validated by FFprobe (media + mcp + shipped-binary run).
- Backend persistence across a full daemon restart.
- A real MCP client (SDK) driving create→import→edit→export; param validation; no-FFmpeg
  errors cleanly (no fake success).
- Agent-config writers preserve existing servers, back up, are idempotent (Claude + OpenCode).

## Honest limitations (unresolved)
- **Rust now installed** (1.100.0, MSVC) and the **Tauri shell compiles** here; a full
  Windows `tauri build` was run. The app window itself was not clicked through visually
  (headless env, no display) — behavior is covered by the bridge tests + the shipped-binary
  e2e, and the UI by typecheck + `vite build`.
- **Transcription needs a whisper.cpp binary + model** on the user's machine (auto-detected;
  model downloadable on consent). The parser/mapping are unit-tested; a live transcription
  run needs the binary, which isn't installed in this env, so `generate_captions` end-to-end
  is proven only up to the whisper call (it errors clearly if whisper is absent — no fakes).
- **Transition fidelity**: crossDissolve and slide are real; zoom/wipe/blur currently render
  as cross-dissolve (documented). Caption timing is segment-level, not word-level yet.
- **FFmpeg not bundled**: releases detect a system/user FFmpeg. A dev copy sits in
  `vendor/ffmpeg` (gitignored) only for local testing.
