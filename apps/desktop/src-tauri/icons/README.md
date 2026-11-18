# App icons

Tauri needs platform icons here (`32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.icns`,
`icon.ico`). Generate them from a single 1024×1024 PNG:

```bash
pnpm --filter @reelforge/desktop tauri icon path/to/reelforge-logo.png
```

This directory is intentionally left without committed binary icons; the release workflow
generates a placeholder if none are present so unsigned CI builds succeed. For production,
commit real icons (do not ship the placeholder).
