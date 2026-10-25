import { knowledge, knowledgeTools, type KnowledgeDocument, type ToolDefinition } from "@klymbak/server";
import shippedIndex from "./docs-index.json";
import { t } from "./messages.ts";

/**
 * Strapi's documentation, read live from docs.strapi.io: its llms.txt index and every page's text
 * (llms-full.txt) are searched here, section by section. Nothing from the conversation is sent: the
 * search runs in this process. When the site can't be reached, the search uses the copy of the
 * index that ships with the plugin, titles and summaries only (scripts/update-docs-index.mjs
 * refreshes it).
 */
export const DOCS_URL = "https://docs.strapi.io";

/**
 * Editors' words for things the docs name differently. Author and editor are Strapi's default
 * admin roles, and admin roles are what the RBAC page covers.
 */
export const SYNONYMS: Record<string, string[]> = {
  translate: ["internationalization", "i18n"],
  language: ["internationalization", "i18n", "locale"],
  locale: ["internationalization", "i18n"],
  permission: ["rbac"],
  role: ["rbac"],
  author: ["rbac"],
  editor: ["rbac"],
  access: ["rbac"],
  image: ["media-library", "media"],
  photo: ["media-library", "media"],
  picture: ["media-library", "media"],
  video: ["media-library", "media"],
  file: ["media-library", "media"],
  asset: ["media-library", "media"],
  upload: ["media-library"],
  schedule: ["release"],
  field: ["content-type-builder", "builder"],
  schema: ["content-type-builder", "builder"],
  model: ["content-type-builder", "builder"],
  workflow: ["review-workflows"],
  approve: ["review-workflows"],
  approval: ["review-workflows"],
  history: ["content-history"],
  restore: ["content-history"],
  login: ["sso"],
};

/**
 * People asking work in the admin panel, so the feature pages (how the admin works) come before the API and
 * migration guides. The MCP server page, about connecting outside AI clients, has a table of example requests
 * ("translate the article into French") that matches everyday questions word for word, so it comes after the rest.
 */
export function boost(page: KnowledgeDocument): number {
  if (page.id === "cms/features/strapi-mcp-server") return 0.5;
  if (page.id.startsWith("cms/features/")) return 1.5;
  if (page.id.startsWith("cms/migration/")) return 0.5;
  return 1;
}

/** Docusaurus leftovers out (anchors, icons, screenshots, styled spans), relative links made absolute. */
export function cleanPage(markdown: string, base = DOCS_URL): string {
  return markdown
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^(#{1,6} .*?)[ \t]*\{#[\w-]+\}[ \t]*$/gm, "$1")
    .replace(/<img\b[^>]*>[ \t]*/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)[ \t]*/g, "")
    .replace(/<span\b[^>]*>([\s\S]*?)<\/span>/g, "$1")
    .replace(/<br\s*\/?>/g, "")
    .replace(/^> Source: .*\n?/m, "")
    .replace(/\]\(\/(?!\/)/g, `](${base}/`)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A saved copy of llms.txt: its page lines, and the day they were fetched. */
export interface OfflineIndex {
  fetched: string;
  lines: string[];
}

export interface DocsOptions {
  /** Defaults to https://docs.strapi.io. */
  baseUrl?: string;
  /** For tests. */
  fetch?: typeof fetch;
  /** The index to search when the site can't be reached. Default: the copy shipped with the plugin. */
  offlineIndex?: OfflineIndex | false;
}

export function docsTools(options: DocsOptions = {}): ToolDefinition<any>[] {
  const base = (options.baseUrl ?? DOCS_URL).replace(/\/+$/, "");
  const offline = options.offlineIndex ?? (shippedIndex as OfflineIndex);
  return knowledgeTools({
    name: "strapi_docs",
    description: `the official Strapi 5 documentation (${base.replace(/^https?:\/\//, "")}): how Strapi works and how to do things in the admin panel, such as roles and permissions, locales, the Content-type Builder, the Media Library, Draft & Publish, Releases, Review Workflows, API tokens, webhooks and settings`,
    sources: [
      knowledge.llmsTxt(`${base}/llms.txt`, {
        name: "docs",
        title: "Strapi docs",
        fetch: options.fetch,
        clean: (markdown) => cleanPage(markdown, base),
        boost,
        fallback: offline ? { text: offline.lines.join("\n"), fetched: offline.fetched } : undefined,
      }),
    ],
    synonyms: SYNONYMS,
    stopwords: ["strapi"],
    labels: { search: (locale) => t(locale, "tool.searchDocs.label"), read: (locale) => t(locale, "tool.readDocs.label") },
    summaries: { search: (locale) => t(locale, "tool.searchDocs.summary"), read: (locale) => t(locale, "tool.readDocs.summary") },
  });
}
