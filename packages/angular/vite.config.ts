import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// ngc compiles the components (see the build script). Vite only bundles the shared stylesheet into
// dist/style.css, the same stylesheet @klymbak/react and @klymbak/vue ship.
export default defineConfig({
  build: {
    rolldownOptions: {
      input: fileURLToPath(new URL("src/style.css", import.meta.url)),
      output: { assetFileNames: "[name][extname]" },
    },
    outDir: "dist",
    emptyOutDir: false,
    copyPublicDir: false,
  },
});
