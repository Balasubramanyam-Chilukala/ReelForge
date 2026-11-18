# ReelForge

**AI-first, cross-platform desktop video editor** for Reels / Shorts / TikToks — with a
real non-linear timeline and a real FFmpeg render engine, controllable by **Claude Code**
and **OpenCode** through a shared MCP server.

> Status: in active development. See [`docs/STATUS.md`](docs/STATUS.md) for the live
> checkpoint of what is implemented and tested.

## Why it's different
The editing engine is headless and testable; the desktop UI and the AI agents are both
just clients of the same backend. So when an agent edits your reel, it mutates the *same*
timeline you see on screen — it doesn't just tell you what to do. One engine, no
duplicated logic between Claude Code and OpenCode.

## Monorepo layout
| Path | What |
|---|---|
| `packages/shared` | Bridge protocol + shared types/schemas |
| `packages/engine` | Pure editing model: timeline, clips, commands, undo/redo, migrations |
| `packages/media` | FFmpeg/FFprobe: probe, thumbnails, proxies, waveforms, export |
| `packages/backend` | Local daemon: state, SQLite, bridge (HTTP+WS), jobs |
| `packages/mcp` | `reelforge-mcp` stdio MCP server (Claude Code + OpenCode) |
| `apps/desktop` | Tauri 2 + React + Vite + Zustand UI |
| `docs/` | Architecture, plan, status, testing, agent integration |

## Develop
```bash
pnpm install
pnpm typecheck
pnpm test
```
Requirements: Node ≥ 22, pnpm. FFmpeg/FFprobe on PATH for media/export features. Rust
toolchain only to build/package the desktop app.

## Docs
- [Architecture](docs/ARCHITECTURE.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Status / checkpoint](docs/STATUS.md)
- [Testing](docs/TESTING.md)
- [Agent integration](docs/AGENT_INTEGRATION.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License
MIT (ReelForge's own code). Third-party components retain their licenses — see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md); note the FFmpeg redistribution policy.
