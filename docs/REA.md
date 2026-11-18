# REA — Reverse Engineer Anything (developer reference-analysis workflow)

> **Developer tool, not part of the shipped product.** REA is used only to *study reference
> applications* during development. ReelForge runs without it, and it is **not** bundled in
> any release. The clone lives under `tools/rea/` and is **gitignored**.

## What REA is
[REA (Reverse Engineer Anything)](https://github.com/morluto/rea) is an MIT-licensed MCP
server + agent skill for evidence-backed reverse engineering of binaries, applications, and
runtime behavior. Package: `rea-agents` (v6.9.0 pinned in `tools/rea` at clone time).

Only obtain REA from its official sources: the [morluto/rea](https://github.com/morluto/rea)
repo, [rea.tools](https://rea.tools/), or the [`rea-agents` npm package](https://www.npmjs.com/package/rea-agents).
A similar repo name or copied README does not make a download official.

## Install & connect it to Claude Code / OpenCode (REA's own supported flow)
REA registers its MCP server and installs matching agent instructions through its setup
command — use REA's **actual** command, not an invented one:

```bash
npx rea-agents@latest setup
```

Then **choose your agents** (Claude Code and/or OpenCode are supported), **review the
proposed configuration changes, and approve them**, then **restart your agent**. For one-off
commands use `npx rea-agents@latest <command>` (or `bunx rea-agents@latest …` with Bun).
See `tools/rea/README.md` and `tools/rea/docs/getting-started/`.

> REA is a **separate** MCP server from `reelforge-mcp`. Registering REA does not change or
> replace ReelForge's agent integration; the two coexist in your agent's MCP config.

## How we used REA for ReelForge (reference analysis of Instagram Edits for Mac)
The goal was to understand *editing workflows* to build a comparable product independently —
never to copy proprietary source, assets, or branding, and never to bypass security, DRM, or
account controls. REA ships purpose-built docs for exactly this kind of desktop study:

- `tools/rea/docs/desktop-applications.md` — desktop app analysis overview
- `tools/rea/docs/desktop-application-capture.md` — capturing runtime behavior
- `tools/rea/docs/desktop-application-state.md` — application/state inspection
- `tools/rea/docs/desktop-application-tasks.md` — task/workflow analysis
- `tools/rea/docs/desktop-application-export.md` — export workflow analysis
- `tools/rea/docs/javascript-route-inventory.md` — JavaScript/Electron route/structure analysis

These informed the ReelForge model: media library → timeline (multi-track, ticks) → inspector
→ caption styles → export presets, and the automatic-reel pipeline (analyze → decide → build
→ render).

## Honest limitation (recorded per the build spec)
Instagram Edits for Mac is **macOS-only** and was **not available on this Windows development
machine**, and REA's native analysis engines (e.g. Ghidra/Hopper/Frida) were **not executed
here**. Therefore the reference analysis relied on REA's documented methodology plus publicly
available information, and ReelForge is an **independent implementation** of comparable
editing workflows — not a reproduction of any proprietary internals. On a macOS machine with
Instagram Edits installed, REA's supported desktop-inspection tools can be run to deepen this
analysis; the workflow above is the entry point.

## License / preservation
REA is MIT-licensed; its upstream `LICENSE` and `THIRD_PARTY_NOTICES.md` are preserved intact
in `tools/rea/`. Nothing from REA is redistributed in ReelForge releases.
