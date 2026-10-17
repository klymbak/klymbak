import { defineConfig } from "vitest/config";

// Integration tests: they boot the demo Strapi app, so the plugin (dist) and the demo must be
// built first. `pnpm test:strapi` at the repo root does both; `pnpm test` leaves these out.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
