import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  // Use the workspace packages' TypeScript sources directly (instant HMR, no build step).
  resolve: { conditions: ["@klymbak/source"] },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
});
