import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The analytics integration tests run full race analysis (and, when the
    // Examples/ fixtures are present, parse real VKX logs), which legitimately
    // takes several seconds — more than vitest's 5s default under the large
    // suite's parallel load. Give them headroom so they don't flake in CI.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
