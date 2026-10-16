import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `--mode single` inlines everything into one HTML file (handy for static previews).
export default defineConfig(({ mode }) => ({
  plugins: [vue(), ...(mode === "single" ? [viteSingleFile()] : [])],
  resolve: { conditions: ["@klymbak/source"] },
  build: mode === "single" ? { outDir: "dist-single" } : {},
}));
