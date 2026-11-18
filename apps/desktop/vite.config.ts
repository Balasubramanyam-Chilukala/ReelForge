import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port and relative asset base.
export default defineConfig({
  plugins: [react()],
  base: "./",
  clearScreen: false,
  resolve: {
    alias: {
      "@reelforge/shared": fileURLToPath(new URL("../../packages/shared/src/index.ts", import.meta.url)),
      "@reelforge/engine": fileURLToPath(new URL("../../packages/engine/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5178,
    strictPort: false,
  },
  build: {
    target: "es2022",
    outDir: "dist",
  },
});
