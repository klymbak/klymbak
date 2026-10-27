import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, type Logger, type Plugin } from "vite";
import type { Content } from "../src/cms.ts";
import { normalize } from "./normalize.ts";
import { fetchSnapshot, type Snapshot } from "./strapi.ts";

export interface CmsOptions {
  url: string;
  /** A read-only API token. Without one, the build uses the snapshot. */
  token?: string;
  /** The Site entry's key. */
  site: string;
  /** The fallback: the content as last pulled (`pnpm --filter site content:pull`). */
  snapshot: string;
}

/** STRAPI_URL and STRAPI_TOKEN come from the environment or the repo root's .env files (`.env.local` is git-ignored). */
export function cmsOptions(mode: string): CmsOptions {
  const env = loadEnv(mode, fileURLToPath(new URL("../../..", import.meta.url)), "STRAPI_");
  return {
    url: (env.STRAPI_URL || "https://strapi.berezhnyk.com").replace(/\/$/, ""),
    token: env.STRAPI_TOKEN || undefined,
    site: "klymbak",
    snapshot: fileURLToPath(new URL("./snapshot.json", import.meta.url)),
  };
}

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Where a locale's home page lives: the default locale at the root, the others under their code. */
export const localePath = (content: Content, locale: string) => (locale === content.defaultLocale ? "/" : `/${locale}/`);

const localeOf = (content: Content, url = "/") => {
  const first = url.split(/[/?#]/)[1] ?? "";
  return content.locales.includes(first) ? first : content.defaultLocale;
};

/** Title, description, canonical and language links, and link previews for a locale's home page. */
function head(content: Content, locale: string): string {
  const site = content.sites[locale]!;
  const home = site.pages.home!;
  const title = home.seo.title ?? site.seo.title ?? site.name;
  const description = home.seo.description ?? site.seo.description;
  const image = home.seo.image ?? site.seo.image;
  const address = (code: string) => `${site.url!.replace(/\/$/, "")}${localePath(content, code)}`;

  const tags = [`<title>${escape(title)}</title>`, `<meta property="og:title" content="${escape(title)}" />`];
  if (description) tags.push(`<meta name="description" content="${escape(description)}" />`, `<meta property="og:description" content="${escape(description)}" />`);
  if (image) tags.push(`<meta property="og:image" content="${escape(image.url)}" />`);
  if (home.seo.noIndex) tags.push(`<meta name="robots" content="noindex" />`);
  if (site.url) {
    tags.push(`<link rel="canonical" href="${escape(address(locale))}" />`, `<meta property="og:url" content="${escape(address(locale))}" />`);
    if (content.locales.length > 1) {
      for (const code of content.locales) tags.push(`<link rel="alternate" hreflang="${code}" href="${escape(address(code))}" />`);
      tags.push(`<link rel="alternate" hreflang="x-default" href="${escape(address(content.defaultLocale))}" />`);
    }
  }
  return tags.join("\n    ");
}

/** index.html marks the generated part of its head with <!--cms-head--><!--/cms-head-->. */
const withHead = (html: string, content: Content, locale: string) =>
  html
    .replace(/<html lang="[^"]*"/, `<html lang="${locale}"`)
    .replace(/<!--cms-head-->[\s\S]*?<!--\/cms-head-->/, `<!--cms-head-->\n    ${head(content, locale)}\n    <!--/cms-head-->`);

/**
 * The site's content from Strapi, read once when the build or the dev server starts, as the module `virtual:cms`.
 * Each locale with a published home page gets its own index.html: the default at the root, others under /<code>/.
 */
export function cms(options: CmsOptions): Plugin {
  const VIRTUAL = "virtual:cms";
  let logger: Logger;
  let content: Content;

  const snapshot = async (): Promise<Snapshot> => {
    if (options.token) {
      try {
        const fresh = await fetchSnapshot({ url: options.url, token: options.token, site: options.site });
        logger.info(`Content from ${options.url}: ${Object.keys(fresh.locales).join(", ")}`);
        return fresh;
      } catch (error) {
        logger.warn(`Strapi didn't answer (${(error as Error).message}). Building from cms/snapshot.json instead.`);
      }
    } else {
      logger.info("No STRAPI_TOKEN set: building from cms/snapshot.json.");
    }
    return JSON.parse(await readFile(options.snapshot, "utf8"));
  };

  return {
    name: "site-cms",
    configResolved(config) {
      logger = config.logger;
    },
    async buildStart() {
      content = normalize(await snapshot(), options.url);
    },
    resolveId: (id) => (id === VIRTUAL ? `\0${VIRTUAL}` : undefined),
    load: (id) => (id === `\0${VIRTUAL}` ? `export default ${JSON.stringify(content)};` : undefined),
    transformIndexHtml: (html, ctx) => withHead(html, content, ctx.server ? localeOf(content, ctx.originalUrl) : content.defaultLocale),
    async writeBundle({ dir }) {
      if (!dir) return;
      const html = await readFile(join(dir, "index.html"), "utf8");
      for (const locale of content.locales.filter((code) => code !== content.defaultLocale)) {
        await mkdir(join(dir, locale), { recursive: true });
        await writeFile(join(dir, locale, "index.html"), withHead(html, content, locale));
      }
    },
  };
}
