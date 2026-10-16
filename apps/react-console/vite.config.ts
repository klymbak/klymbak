import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // Use the workspace packages' TypeScript sources directly (instant HMR, no build step).
  resolve: { conditions: ["@klymbak/source"] },
  server: {
    port: 5175,
    proxy: { "/api": { target: "http://localhost:8787", changeOrigin: true } },
  },
});
