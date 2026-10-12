import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Starting the Temporal test server and bundling workflows takes a while.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // The worker bundles workflow code itself; run tests in one process.
    pool: "forks",
  },
});
