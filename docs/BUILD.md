# ReelForge — Build, Install & Run

## Prerequisites
- **Node ≥ 22** and **pnpm** (`npm i -g pnpm`).
- **FFmpeg + FFprobe** on PATH (for probing, preview, and export). Windows: `choco install ffmpeg`;
  macOS: `brew install ffmpeg`. Or set `REELFORGE_FFMPEG` / `REELFORGE_FFPROBE` to explicit paths.
- **Rust toolchain** (stable) — only needed to build/package the desktop app, not for the
  engine/backend/MCP. Install from https://rustup.rs. On Windows also install the
  "Desktop development with C++" workload (MSVC) and WebView2 (preinstalled on Win 11).

## Install & verify (all platforms)
```bash
pnpm install
pnpm build            # compile all TypeScript packages
pnpm typecheck        # tsc --noEmit across the workspace
pnpm test             # 67 tests; FFmpeg-dependent e2e auto-skips if FFmpeg is absent
pnpm bundle           # produce self-contained daemon + MCP single-file bundles
```

## Run (developer mode, no Tauri)
Terminal 1 — start the backend daemon (prints its port + writes the state file):
```bash
pnpm backend
# or the bundled single file:
node packages/backend/dist/reelforge-backend.bundle.cjs
```
Terminal 2 — start the UI dev server:
```bash
pnpm --filter @reelforge/desktop dev
```
Open the printed URL. If the UI can't auto-discover the backend in the browser, open it with
`?bridge=PORT:TOKEN` (values from the daemon log) or paste them in **Settings**.

## Run the full desktop app (Tauri)
```bash
pnpm build && pnpm bundle                 # ensure bundles exist (shipped as resources)
pnpm --filter @reelforge/desktop tauri dev
```
The Tauri shell spawns the backend automatically and the UI connects with no manual step.

## Build installers

### Windows (on Windows)
```bash
pnpm build && pnpm bundle
pnpm --filter @reelforge/desktop tauri build
```
Produces an NSIS installer under `apps/desktop/src-tauri/target/release/bundle/nsis/`.

### macOS (on macOS, Intel + Apple Silicon)
```bash
pnpm build && pnpm bundle
pnpm --filter @reelforge/desktop tauri build -- --target universal-apple-darwin
```
Produces `.app` and `.dmg` under `apps/desktop/src-tauri/target/.../bundle/`.

> Build Windows releases on Windows runners and macOS releases on macOS runners — cross-OS
> packaging is not supported. See `.github/workflows/release.yml`.

## Signing & notarization (production)
Builds are **unsigned by default** (fine for local/dev; users see an OS warning). For signed
production releases, provide secrets to the release workflow — never commit certificates:
- macOS: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` (enables codesign + notarization).
- Windows: configure your code-signing certificate per Tauri's Windows signing guide.

## Connect AI agents
After installing Claude Code and/or OpenCode:
```bash
# point agents at the bundled MCP server (no secrets stored in agent config):
node packages/agent-setup/dist/bin/reelforge-connect.js --agent both \
  --script "$(pwd)/packages/mcp/dist/reelforge-mcp.bundle.cjs"
# status:
node packages/agent-setup/dist/bin/reelforge-connect.js --status
```
Or use the in-app **AI Agents** tab. The MCP server auto-discovers the running backend.

## Captions / transcription setup
Two backends, auto-selected:
- **Cloud (fast, accurate):** set `GROQ_API_KEY` in the environment. ReelForge then uses
  Groq `whisper-large-v3-turbo` with word timestamps. Audio is uploaded to Groq; nothing
  else is. Off unless the key is set.
- **Local (offline, default):** install whisper.cpp + a model. One-click via the
  `setup_transcription` MCP tool (downloads a prebuilt binary + model on Windows/Linux), or
  `brew install whisper-cpp` on macOS, or set `REELFORGE_WHISPER` / `REELFORGE_WHISPER_MODEL`.

Caption styles: `generate_captions` supports `mode: "phrase" | "word" | "group"` — `word`
and `group` give the trendy word-by-word / karaoke highlight look.

## FFmpeg licensing (before distributing binaries)
See `THIRD_PARTY_NOTICES.md`. Prefer a user-provided/system FFmpeg; if bundling, bundle a
verified **LGPL** build with its license text — never a GPL build.
