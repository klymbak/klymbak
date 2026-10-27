import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { defineConfig, normalizePath, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { cms, cmsOptions } from "./cms/plugin.ts";

// index.html links its icons from docs/brand. The build resolves them like any asset; the dev server needs the /@fs/ path.
const brand = normalizePath(fileURLToPath(new URL("../../docs/brand", import.meta.url)));
const brandIcons: Plugin = {
  name: "brand-icons",
  apply: "serve",
  transformIndexHtml: (html) => html.replaceAll('href="../../docs/brand/', `href="/@fs/${brand}/`),
};

// `--mode single` inlines everything into one HTML file (handy for static previews).
// The copy comes from Strapi when STRAPI_TOKEN is set, from cms/snapshot.json otherwise.
export default defineConfig(({ mode }) => ({
  plugins: [vue(), brandIcons, cms(cmsOptions(mode)), ...(mode === "single" ? [viteSingleFile()] : [])],
  resolve: { conditions: ["@klymbak/source"] },
  build: mode === "single" ? { outDir: "dist-single" } : {},
}));
