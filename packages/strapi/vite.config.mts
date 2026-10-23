import { readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Two bundles, like @strapi/sdk-plugin builds them: `vite build --mode server` for Strapi's
// server (it require()s dist/server/index.js) and `--mode admin` for its admin build (Vite).
// Every dependency stays external, so the host app resolves one copy of React, the design
// system and @klymbak/*.
const pkg = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const externals = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
// Files imported as text (`?inline`) are bundled: the admin carries the stylesheet itself (see theme.tsx).
const external = (id: string) =>
  !id.endsWith("?inline") && (isBuiltin(id) || externals.some((dep) => id === dep || id.startsWith(`${dep}/`)));

export default defineConfig(({ mode }) => {
  const admin = mode === "admin";
  return {
    plugins: admin ? [react()] : [],
    build: {
      outDir: admin ? "dist/admin" : "dist/server",
      emptyOutDir: true,
      sourcemap: true,
      minify: false,
      target: admin ? "es2022" : "node22",
      lib: {
        entry: fileURLToPath(new URL(admin ? "admin/src/index.ts" : "server/src/index.ts", import.meta.url)),
        formats: ["es", "cjs"],
        fileName: (format) => (format === "es" ? "index.mjs" : "index.js"),
      },
      rollupOptions: {
        external,
        output: { exports: "named" },
      },
    },
  };
});
