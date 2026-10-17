import vue from "@vitejs/plugin-vue";
import { configDefaults, defineConfig } from "vitest/config";

// Workspace packages resolve to their TypeScript sources through the
// "@klymbak/source" export condition, so tests never need a build first.
const conditions = ["@klymbak/source", "module", "node", "development|production"];

export default defineConfig({
  plugins: [vue()],
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: ["@klymbak/source"] } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          include: ["packages/*/src/**/*.test.{ts,tsx}", "packages/*/{server,admin}/src/**/*.test.{ts,tsx}", "apps/*/src/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "packages/angular/**"],
          environment: "node",
          testTimeout: 20_000,
        },
      },
      // Angular components go through the Angular compiler, so they have a project of their own.
      "packages/angular",
    ],
  },
});
