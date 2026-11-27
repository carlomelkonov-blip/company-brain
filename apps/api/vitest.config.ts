import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests share one Postgres server; run files one at a time.
    fileParallelism: false,
    setupFiles: ["./test/setup-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
