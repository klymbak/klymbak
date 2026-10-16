import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
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
      external: ["vue", /^@klymbak\/(protocol|client)$/],
    },
    sourcemap: true,
  },
});
