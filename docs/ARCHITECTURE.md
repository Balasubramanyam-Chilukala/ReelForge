# ReelForge — Architecture

> Written for: engineers building on or resuming ReelForge.

ReelForge is an AI-first, cross-platform (Windows + macOS) desktop video editor.
Its defining goal: **an AI coding agent (Claude Code or OpenCode) can control the
*actual* editor** — mutating a real timeline, running real FFmpeg renders — not just
emitting advice.

## 1. Guiding principle: one engine, many clients

The single most important architectural decision is that **editing logic lives in a
headless core, never in the UI or in an agent adapter.** Everything that can change a
project goes through one place.

```
                       ┌─────────────────────────────────────────────┐
                       │            @reelforge/backend               │
                       │        (local daemon, Node process)         │
                       │                                             │
   Desktop UI  ─ WS ──▶│  • owns authoritative project state         │
  (Tauri/React)        │  • @reelforge/engine  (pure model + ops)    │
                       │  • @reelforge/media   (FFmpeg/FFprobe)      │
   reelforge-mcp ─HTTP▶│  • SQLite persistence (node:sqlite)         │
  (Claude / OpenCode)  │  • job queue (analyze / render / export)    │
                       │  • event bus → WS broadcast (live updates)  │
                       └─────────────────────────────────────────────┘
```

- **`@reelforge/engine`** — pure, deterministic, I/O-free TypeScript. The project
  document model, the timeline (rational/frame-based time), every editing *operation*
  as a command with `apply`/`invert` for undo/redo, and the versioned schema +
  migrations. No filesystem, no FFmpeg, no network — so it is exhaustively unit-testable.
- **`@reelforge/media`** — all FFmpeg/FFprobe interaction: probe metadata, generate
  thumbnails/proxies/waveforms, scene detection, and the **filtergraph compiler** that
  turns a timeline into an FFmpeg command for export. Spawns processes; never mutates
  the project model.
- **`@reelforge/backend`** — the daemon. Holds the authoritative in-memory project,
  applies engine commands, persists to SQLite, schedules jobs, and exposes a
  **local-only bridge** (HTTP for request/response + WebSocket for live events).
- **`@reelforge/mcp`** (`reelforge-mcp` binary) — a thin stdio MCP server. Each tool
  validates its parameters (zod) and calls the backend bridge. **It contains zero
  editing logic.** Claude Code and OpenCode use the *same* server, so there is exactly
  one implementation of every capability.
- **`apps/desktop`** — Tauri 2 + React + Vite + Zustand. A *client* of the bridge. It
  renders the authoritative state and reflects agent-driven changes live via WS.

Because the engine and backend are headless, the agent-control requirement and the
entire edit model are testable with no GUI and no Rust toolchain.

## 2. Why this stack

| Concern | Choice | Reason |
|---|---|---|
| Desktop shell | Tauri 2 | Small binaries, native webview, Rust backend, good Win+mac support. |
| UI | React + TypeScript + Vite + Zustand | Mandated; Zustand keeps timeline state ergonomic. |
| Engine language | TypeScript | Shared verbatim between UI and backend; one model, no FFI boundary for edits. |
| Persistence | `node:sqlite` (built into Node 22+) | Zero native-module compile → trivially cross-platform. Abstracted behind a `Database` port so better-sqlite3 can swap in later. |
| Video | FFmpeg + FFprobe (external processes) | Industry standard. Detected at runtime; never statically linked (keeps us clear of GPL linking obligations — see `THIRD_PARTY_NOTICES.md`). |
| Agent protocol | MCP over stdio (`@modelcontextprotocol/sdk`) | The protocol both Claude Code and OpenCode speak. |

### Note on the Rust/Tauri boundary
The Rust side of the Tauri app is deliberately **thin**: window management, native file
dialogs, OS paths, and spawning/supervising the backend daemon. It holds no editing
logic. This keeps the irreplaceable logic in testable TypeScript and means the Rust
toolchain is needed only to *package* the desktop app, not to develop or test the core.

## 3. Time model

All timeline positions and durations are **rational ticks**, not floats. The project
has a global `timebase` (default `30000/1001` is avoided — we use an integer tick rate,
default **90000 ticks/sec**, the MPEG standard, which exactly represents 24/25/30/50/60
and common fractional rates). Clips store source in/out and timeline start as integer
ticks. This eliminates cumulative float drift across cuts, speed changes, and exports.
See `packages/engine/src/time.ts`.

## 4. Data flow of an edit (UI or agent, identical path)

1. Client sends an intent (e.g. `trim_clip`) to the backend bridge.
2. Backend builds the corresponding **engine command**, validates against current state.
3. Command is `apply`-ed → new project state; its inverse is pushed to the undo stack.
4. Change is persisted (debounced autosave) and the resulting patch is broadcast over WS.
5. Every connected client (UI + any agent watching) updates. The user *sees* the change.

## 5. Security & safety model

- Bridge binds to `127.0.0.1` only, with a per-session token the backend writes to a
  user-readable state file that MCP/UI read. Never exposed publicly.
- MCP tools can **not** run arbitrary shell commands. File operations are confined to the
  project directory and user-approved media roots.
- Transcripts, media metadata, and filenames are treated as **untrusted data**, never as
  instructions (see `AGENT_INTEGRATION.md`).
- Destructive ops (delete media, overwrite export) require confirmation / are blocked by
  default. Original media is never deleted. Nothing is ever uploaded anywhere.

## 6. Repository layout

```
packages/
  engine/     pure model + timeline + commands + schema/migrations  (no I/O)
  media/      ffmpeg/ffprobe: probe, thumbs, waveform, scenes, export filtergraph
  backend/    daemon: state, sqlite, bridge (http+ws), job queue
  mcp/        reelforge-mcp stdio server (tools → bridge)
  shared/     cross-cutting types, bridge protocol contracts, zod schemas
apps/
  desktop/    Tauri 2 + React + Vite + Zustand UI
tools/
  rea/        (dev only, gitignored) cloned Reverse-Engineer-Anything research tool
docs/         ARCHITECTURE / IMPLEMENTATION_PLAN / STATUS / TESTING / AGENT_INTEGRATION
```

See `IMPLEMENTATION_PLAN.md` for phase ordering and `STATUS.md` for the live checkpoint.
