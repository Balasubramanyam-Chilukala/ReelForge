# ReelForge — Agent Integration (Claude Code & OpenCode)

ReelForge exposes its editor to AI agents through one MCP server, **`reelforge-mcp`**,
shared by Claude Code and OpenCode. There is a single implementation of every tool; both
clients call the same backend. (Setup commands are finalized in Phase 5; this document is
the design + safety contract.)

## How it connects
```
Claude Code ─┐
             ├─(stdio MCP)─▶ reelforge-mcp ─(HTTP, 127.0.0.1 + token)─▶ ReelForge backend
OpenCode    ─┘                                                          (authoritative state)
```
- `reelforge-mcp` is a stdio server. It holds **no editing logic**; each tool validates
  parameters (zod) and forwards to the backend bridge, returning structured results.
- The backend bridge is **loopback-only** with a per-session token. The MCP server reads
  the token from the backend's state file. The editor is never exposed publicly.

## Tool surface (see spec §9) — 45 tools, all functional
Project: `get_editor_status`, `list_projects`, `create_project`, `open_project`,
`save_project`, `get_project_details`.
Media: `import_media`, `list_media`, `get_media_metadata`, `analyze_media`,
`extract_keyframes`, `generate_contact_sheet`, `get_transcript`, `detect_scenes`,
`detect_silence`, `get_whisper_status`, `download_transcription_model`, `setup_transcription`.
Timeline: `get_timeline`, `create_timeline`, `add_clip`, `remove_clip`, `trim_clip`,
`split_clip`, `move_clip`, `reorder_clips`, `set_clip_speed`, `set_clip_transform`,
`set_clip_fit`, `add_transition`, `auto_rough_cut`, `auto_reframe`, `apply_punch_in`.
Captions/text: `generate_captions` (modes: phrase / word / group — karaoke; Groq or local
whisper.cpp), `edit_caption`, `style_captions`, `add_text_overlay`, `animate_text`.
Audio/effects: `add_audio_track`, `adjust_audio`, `set_audio_fade`, `apply_audio_ducking`
(sidechain), `apply_color_adjustment`, `apply_effect`.
Preview/render: `render_preview`, `capture_preview_frame`, `export_video`,
`get_export_status`.
History: `undo`, `redo`.

All Phase-7 tools are now functional (local transcription, auto-captions, silence detection,
auto rough-cut, sidechain ducking). Transcription requires a user-installed whisper.cpp
binary + model (auto-detected; downloadable on consent); if absent, the tool errors clearly.

## Safety contract (enforced, not advisory)
- **Read-only vs mutating:** each tool is classified. Read-only tools run freely. Mutating
  tools go through the engine command path (so they land in undo history and the activity
  log) and respect the current approval mode.
- **Approval mode:** `auto` (trusted) applies changes immediately; `review` records the
  agent's proposed batch and waits for the user to apply/discard in the UI.
- **Destructive guards:** never delete original media; never overwrite an existing export
  without an explicit `overwrite` flag; never upload/publish anywhere.
- **No arbitrary execution:** tools cannot run shell commands or scripts. File access is
  restricted to the project directory and user-approved media roots.
- **Untrusted data:** transcripts, media metadata, filenames, and scene labels are returned
  to the agent as *data*. The server never interprets their contents as instructions, and
  documents this to the agent via tool descriptions.

## Connecting the clients (filled in Phase 5 with verified commands)
- **Claude Code:** registered as a local stdio MCP server (`claude mcp add` / project
  `.mcp.json`). The in-app wizard detects the Claude Code config location, backs it up,
  adds only the ReelForge entry, preserves existing servers, and validates the result.
- **OpenCode:** registered under `mcp` with `type: "local"` and a command array, per
  OpenCode's current config schema. The wizard detects the installed version and validates
  the schema before writing.

See `STATUS.md` for what is implemented vs. pending.
