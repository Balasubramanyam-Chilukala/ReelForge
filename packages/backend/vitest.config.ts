import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@reelforge/engine": src("../engine/src/index.ts"),
      "@reelforge/media": src("../media/src/index.ts"),
      "@reelforge/shared": src("../shared/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
