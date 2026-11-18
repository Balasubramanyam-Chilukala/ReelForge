import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Resolve @reelforge/engine to its TypeScript source so media tests run without a
// prior build step. Production builds use tsc project references + the package "exports".
export default defineConfig({
  resolve: {
    alias: {
      "@reelforge/engine": fileURLToPath(new URL("../engine/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
