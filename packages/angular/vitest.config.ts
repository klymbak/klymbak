import { fileURLToPath } from "node:url";
import angular from "@analogjs/vite-plugin-angular";
import { defineConfig } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));

// Angular components need the Angular compiler, so this package's tests run as their own Vitest project.
export default defineConfig({
  plugins: [angular({ tsconfig: `${here}tsconfig.spec.json`, workspaceRoot: here, jit: false })],
  resolve: { conditions: ["@klymbak/source", "module", "browser", "development|production"] },
  test: {
    name: "angular",
    include: ["src/**/*.test.ts"],
    environment: "happy-dom",
    setupFiles: ["src/test-setup.ts"],
    testTimeout: 20_000,
  },
});
