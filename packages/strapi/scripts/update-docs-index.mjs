// Refreshes the copy of docs.strapi.io's page index (llms.txt) that ships with the plugin, for
// servers that can't reach the site. Run `pnpm --filter @klymbak/strapi docs:index` and commit it.
import { writeFile } from "node:fs/promises";

const source = "https://docs.strapi.io/llms.txt";
const response = await fetch(source);
if (!response.ok) throw new Error(`${source} answered ${response.status}.`);
const lines = (await response.text())
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("- ["));
if (lines.length < 100) throw new Error(`${source} lists only ${lines.length} pages, so the copy was left as it is.`);

const fetched = new Date().toISOString().slice(0, 10);
await writeFile(new URL("../server/src/docs-index.json", import.meta.url), `${JSON.stringify({ source, fetched, lines }, null, 2)}\n`);
console.log(`Saved ${lines.length} pages from ${source}.`);
