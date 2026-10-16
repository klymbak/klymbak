import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: { conditions: ["@klymbak/source"] },
  build: {
    lib: {
      entry: fileURLToPath(new URL("src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: "index",
      cssFileName: "style",
    },
    rollupOptions: {
      // The shared stylesheet is bundled into this package's style.css; only the JS stays external.
      external: ["react", "react-dom", "react/jsx-runtime", /^@klymbak\/(protocol|client)$/],
    },
    sourcemap: true,
  },
});
