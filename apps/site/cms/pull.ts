// Refreshes cms/snapshot.json, the content the site builds from when Strapi can't be reached.
// Run with `pnpm --filter site content:pull`, then commit the result.
import { writeFile } from "node:fs/promises";
import { cmsOptions } from "./plugin.ts";
import { fetchSnapshot } from "./strapi.ts";

const { url, token, site, snapshot } = cmsOptions("production");
if (!token) throw new Error("Set STRAPI_TOKEN (in the repo root's .env.local, for example) to pull content.");
const fresh = await fetchSnapshot({ url, token, site });
await writeFile(snapshot, `${JSON.stringify(fresh, null, 2)}\n`);
console.log(`Saved ${Object.keys(fresh.locales).join(", ")} from ${url} to cms/snapshot.json`);
