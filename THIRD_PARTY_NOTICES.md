# Third-Party Notices

ReelForge depends on third-party software. This file tracks components and their license
obligations. It is updated as dependencies are added.

## FFmpeg (critical — read before distributing binaries)

ReelForge invokes **FFmpeg** and **FFprobe** as **separate external processes** (via
`child_process`). It does **not** statically or dynamically link against FFmpeg libraries.
This keeps ReelForge's own code clear of FFmpeg's (L)GPL *linking* obligations.

However, **redistributing an FFmpeg binary** with an installer carries obligations that
depend on how that binary was built:
- An **LGPL** FFmpeg build (no GPL-only components such as x264/x265 compiled in) may be
  redistributed alongside ReelForge provided the LGPL terms are met (license text +
  offer/availability of corresponding source for the FFmpeg libraries).
- A **GPL** FFmpeg build (e.g. with `--enable-gpl`, x264, x265) imposes GPL obligations on
  the distributed combination. **Do not ship a GPL build** with ReelForge releases.

**Policy for ReelForge releases:**
1. Prefer to **detect a user-provided / system FFmpeg** and not redistribute one at all.
2. If a binary is bundled, bundle a verified **LGPL** build, include its license text and a
   source offer in the installer, and record the exact build/version here.
3. CI must fail the release if a bundled FFmpeg's license cannot be verified.

Nothing is bundled yet, so no FFmpeg binary is currently distributed.

## Reverse Engineer Anything (REA)
Cloned under `tools/rea/` **for development/research only** and **gitignored** — not part of
the shipped product. Package `rea-agents`, **version 6.9.0**, **MIT License**. Its upstream
`LICENSE` and `THIRD_PARTY_NOTICES.md` are preserved intact in that directory. Nothing from
REA is redistributed in ReelForge releases. See `docs/REA.md`.

## npm dependencies
Node/TypeScript dependencies and their licenses are enumerated by CI (`license-checker`)
and appended here per release. Current direct dependencies:
- `typescript`, `vitest`, `@types/node` (dev) — Apache-2.0 / MIT.
- `zod` — MIT.
- `@modelcontextprotocol/sdk` — MIT.
- `ws` — MIT.
(Full transitive list generated at release time.)

## Groq cloud transcription (optional)
When the user sets `GROQ_API_KEY`, ReelForge can transcribe via Groq's OpenAI-compatible
Whisper endpoint (`whisper-large-v3-turbo`) for speed/accuracy. This sends the extracted
audio to Groq's servers and is **off by default** (local whisper.cpp is the default). The
key is read from the environment/settings and **never hardcoded or logged**. Users opting
into cloud transcription should review Groq's terms and privacy policy. No other data
(project content, media) is sent — only the audio to be transcribed.

## Local transcription (whisper.cpp + ggml models)
ReelForge's optional speech-to-text uses **whisper.cpp** (MIT) invoked as an **external
process** — it is not bundled or linked. The app detects a user-installed `whisper-cli` /
`whisper` / `main` binary. ggml model files are **downloaded only with explicit user
consent** from the official whisper.cpp model repository on Hugging Face
(`ggerganov/whisper.cpp`, MIT) into the user's cache dir; they are not redistributed with
ReelForge. No audio is sent to any cloud service — transcription is fully local. (A cloud
STT backend is intentionally not used, to keep processing local and key-free.)

## Bundled fonts / assets
Any fonts used for caption rendering must be redistributable (e.g. SIL OFL). None bundled
yet; recorded here when added.
