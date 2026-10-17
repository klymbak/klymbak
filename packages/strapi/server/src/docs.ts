import { defineTool, Type, ui, type ToolDefinition, type ToolOutput } from "@klymbak/server";
import shippedIndex from "./docs-index.json";

/**
 * Strapi's documentation, read live from docs.strapi.io: its llms.txt index (every page's title
 * and one-line summary) is searched here, and pages are fetched as Markdown. Nothing from the
 * conversation is sent: the search runs in this process. When the site can't be reached, the search
 * uses the copy of the index that ships with the plugin (scripts/update-docs-index.mjs refreshes it).
 */
export const DOCS_URL = "https://docs.strapi.io";

const TTL_MS = 24 * 60 * 60_000;
/** With only the shipped copy of the index, try the site again after this long. */
const OFFLINE_RETRY_MS = 10 * 60_000;
const TIMEOUT_MS = 15_000;
const MAX_CACHED_PAGES = 40;
/** Longer pages return their outline first, then one section at a time. */
const PAGE_LIMIT = 20_000;
const INTRO_LIMIT = 4_000;

export interface DocPage {
  /** e.g. "cms/features/draft-and-publish" */
  path: string;
  title: string;
  summary: string;
}

/** "https://docs.strapi.io/cms/features/rbac.md#roles" or "/cms/features/rbac/" → "cms/features/rbac" */
export function pagePath(reference: string): string {
  return reference
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[#?].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.md$/i, "");
}

/** Parses an llms.txt index: "- [Title](https://docs.strapi.io/cms/features/rbac.md): Summary". */
export function parseIndex(text: string): DocPage[] {
  const pages: DocPage[] = [];
  for (const line of text.split("\n")) {
    const match = /^-\s*\[([^\]]+)\]\(([^)\s]+)\)(?::\s*(.*))?$/.exec(line.trim());
    const path = match ? pagePath(match[2]!) : "";
    if (match && path) pages.push({ path, title: match[1]!.trim(), summary: (match[3] ?? "").trim() });
  }
  return pages;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Common words, plus the verbs of requests ("add a new…", "give…"), which match the wrong pages. */
const STOPWORDS = new Set(
  `a about add adding all also an and any are as at be by can could create do does for from get give has have help how i if in
  into is it its let like make me my need new no not of on or our please set should so some than that the their them then there
  these this to us use using want was way we what when where which who why will with would you your strapi`.split(/\s+/),
);

/** Crude stemming, enough to match "translations" with "translate" and "roles" with "role". */
const SUFFIXES: [string, string][] = [["ies", "y"], ["ings", ""], ["ing", ""], ["ions", ""], ["ion", ""], ["ed", ""], ["es", ""], ["s", ""], ["e", ""]];

export function stem(word: string): string {
  if (word.includes("-") || /\d/.test(word)) return word;
  for (const [suffix, replacement] of SUFFIXES) {
    if (suffix === "s" && /(ss|us|is)$/.test(word)) continue;
    if (word.endsWith(suffix) && word.length - suffix.length >= 3) return word.slice(0, -suffix.length) + replacement;
  }
  return word;
}

/** Stems, plus hyphenated words whole ("content-type-builder") and in parts. */
function terms(text: string): string[] {
  const out = new Set<string>();
  const add = (word: string) => {
    if (word && !STOPWORDS.has(word)) out.add(stem(word));
  };
  for (const word of text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []) {
    if (word.includes("-")) {
      out.add(word);
      word.split("-").forEach(add);
    } else add(word);
  }
  return [...out];
}

/**
 * Editors' words for things the docs name differently. Author and editor are Strapi's default
 * admin roles, and admin roles are what the RBAC page covers.
 */
const SYNONYM_WORDS: Record<string, string[]> = {
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
/** Stemmed on both sides, as page words are. */
const SYNONYMS = new Map(Object.entries(SYNONYM_WORDS).map(([word, synonyms]) => [stem(word), synonyms.map(stem)]));
const SYNONYM_WEIGHT = 0.8;

/** Title words count most, then the page's path, then its summary. */
const FIELD_WEIGHTS = [3, 2, 1];

export class DocsIndex {
  private readonly entries: { page: DocPage; fields: Set<string>[] }[];
  private readonly df = new Map<string, number>();
  readonly pages: DocPage[];

  constructor(pages: DocPage[]) {
    this.pages = pages;
    this.entries = pages.map((page) => ({
      page,
      fields: [terms(page.title), terms(page.path.replace(/\//g, " ")), terms(page.summary)].map((field) => new Set(field)),
    }));
    for (const { fields } of this.entries) {
      for (const term of new Set(fields.flatMap((field) => [...field]))) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    }
  }

  find(path: string): DocPage | undefined {
    return this.pages.find((page) => page.path === path);
  }

  search(query: string, limit = 6): DocPage[] {
    // Each query word is a concept; its synonyms count for it at a little less weight.
    const concepts = terms(query).map((term) => [
      { term, weight: 1 },
      ...(SYNONYMS.get(term) ?? []).map((synonym) => ({ term: synonym, weight: SYNONYM_WEIGHT })),
    ]);
    if (!concepts.length) return [];
    const idf = (term: string) => Math.log(1 + this.pages.length / (this.df.get(term) ?? this.pages.length));
    return this.entries
      .map(({ page, fields }) => {
        let score = 0;
        let matched = 0;
        for (const concept of concepts) {
          const best = Math.max(
            ...concept.map(({ term, weight }) => weight * idf(term) * fields.reduce((sum, field, i) => sum + (field.has(term) ? FIELD_WEIGHTS[i]! : 0), 0)),
          );
          if (best > 0) matched++;
          score += best;
        }
        // Pages that cover more of the question rank higher. People asking work in the admin panel,
        // so the feature pages (how the admin works) come before the API and migration guides.
        score *= 0.5 + (0.5 * matched) / concepts.length;
        if (page.path.startsWith("cms/features/")) score *= 1.5;
        if (page.path.startsWith("cms/migration/")) score *= 0.5;
        return { page, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ page }) => page);
  }
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

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

interface Heading {
  level: number;
  text: string;
  start: number;
}

function headings(markdown: string): Heading[] {
  const found: Heading[] = [];
  let fenced = false;
  let offset = 0;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = fenced ? null : /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) found.push({ level: match[1]!.length, text: match[2]!, start: offset });
    offset += line.length + 1;
  }
  return found;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function outline(all: Heading[]): string {
  return all
    .filter((heading) => heading.level === 2 || heading.level === 3)
    .map((heading) => `${heading.level === 3 ? "  " : ""}- ${heading.text}`)
    .join("\n");
}

/**
 * What the model reads of a page: all of it when it is short; otherwise the intro and the outline,
 * or the one section asked for (with its subsections).
 */
export function pageExcerpt(markdown: string, section?: string): string {
  const all = headings(markdown);
  if (section) {
    const wanted = normalize(section);
    const heading = all.find((h) => normalize(h.text) === wanted) ?? all.find((h) => normalize(h.text).includes(wanted));
    if (!heading) return `This page has no section "${section}". Its sections:\n${outline(all)}`;
    const end = all.find((h) => h.start > heading.start && h.level <= heading.level)?.start ?? markdown.length;
    return cut(markdown.slice(heading.start, end).trim(), PAGE_LIMIT);
  }
  if (markdown.length <= PAGE_LIMIT) return markdown;
  const firstSection = all.find((h) => h.level === 2)?.start ?? INTRO_LIMIT;
  return [
    cut(markdown.slice(0, firstSection).trim(), INTRO_LIMIT),
    `This page is long, so read it one section at a time: call read_strapi_docs again with \`section\` set to one of these headings.\n${outline(all)}`,
  ].join("\n\n");
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}\n\n[…cut. Ask for a narrower section to read the rest.]`;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

class DocsError extends Error {}

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
  const fetchText = async (url: string, signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const response = await (options.fetch ?? fetch)(url, {
      headers: { accept: "text/markdown, text/plain;q=0.9" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (response.status === 404) throw new DocsError("not found");
    if (!response.ok) throw new DocsError(`the server answered ${response.status}`);
    return response.text();
  };

  const offlineIndex = options.offlineIndex ?? (shippedIndex as OfflineIndex);
  let offlineDocs: DocsIndex | undefined;
  const offline = () => (offlineIndex ? (offlineDocs ??= new DocsIndex(parseIndex(offlineIndex.lines.join("\n")))) : undefined);
  /** `offline` is the shipped copy's date, when that is what the search uses. */
  type LoadedIndex = { docs: DocsIndex; at: number; offline?: string };
  let index: LoadedIndex | undefined;
  let loading: Promise<LoadedIndex> | undefined;
  /**
   * Fetched on first use and kept for a day. When the site is unreachable, an older fetched copy
   * beats the shipped one, and the shipped one beats none.
   */
  async function loadIndex(): Promise<LoadedIndex> {
    if (index && Date.now() - index.at < (index.offline ? OFFLINE_RETRY_MS : TTL_MS)) return index;
    loading ??= fetchText(`${base}/llms.txt`)
      .then((text) => {
        const docs = new DocsIndex(parseIndex(text));
        if (!docs.pages.length) throw new DocsError("its page index (llms.txt) was empty");
        index = { docs, at: Date.now() };
        return index;
      })
      .catch((error: unknown) => {
        if (index && !index.offline) return index;
        if (!offlineIndex) throw error;
        index = { docs: offline()!, at: Date.now(), offline: offlineIndex.fetched };
        return index;
      })
      .finally(() => {
        loading = undefined;
      });
    return loading;
  }

  const pages = new Map<string, { text: string; at: number }>();
  async function loadPage(path: string, signal: AbortSignal): Promise<string> {
    const cached = pages.get(path);
    if (cached && Date.now() - cached.at < TTL_MS) return cached.text;
    const text = cleanPage(await fetchText(`${base}/${path}.md`, signal), base);
    pages.delete(path);
    pages.set(path, { text, at: Date.now() });
    if (pages.size > MAX_CACHED_PAGES) pages.delete(pages.keys().next().value!);
    return text;
  }

  /** With the page the model asked for, its summary from the index, which may be all there is. */
  const unreachable = (error: unknown, page?: DocPage): ToolOutput => ({
    text: [
      `Couldn't read the Strapi docs at ${base} (${error instanceof Error ? error.message : String(error)}).`,
      page ? `The docs index describes this page as: ${page.title}. ${page.summary}` : "",
      "Answer from what you know about this project if you can, and say that you couldn't check the docs.",
    ]
      .filter(Boolean)
      .join(" "),
    isError: true,
  });

  const search = defineTool({
    name: "search_strapi_docs",
    label: "Search Strapi docs",
    description:
      "Searches the official Strapi 5 documentation (docs.strapi.io) by page title and summary. Use it for questions about how Strapi works or how to do something in the admin panel: roles and permissions, locales, the Content-type Builder, the Media Library, Draft & Publish, Releases, Review Workflows, API tokens, webhooks, settings. Returns pages with a one-line summary; read one with read_strapi_docs.",
    readOnly: true,
    parameters: Type.Object({
      query: Type.String({ description: 'What to look for, in plain words, e.g. "let a role publish entries" or "add a locale".' }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "How many pages to return. Default 6." })),
    }),
    execute: async ({ query, limit }) => {
      let loaded: LoadedIndex;
      try {
        loaded = await loadIndex();
      } catch (error) {
        return unreachable(error);
      }
      const found = loaded.docs.search(query, limit ?? 6);
      if (!found.length) return `No Strapi docs page matched "${query}". Try other words, such as the feature's name.`;
      const source = loaded.offline
        ? `from the copy of the docs index that ships with the plugin (${loaded.offline}), since ${base} can't be reached, so read_strapi_docs will likely fail too and the summaries may be all there is`
        : "read one with read_strapi_docs";
      return [
        `Strapi docs pages for "${query}" (${source}):`,
        ...found.map((page) => `- ${page.path}: ${page.title}. ${page.summary}`),
      ].join("\n");
    },
  });

  const read = defineTool({
    name: "read_strapi_docs",
    label: "Read Strapi docs",
    description:
      'Reads a page of the official Strapi documentation as Markdown. Pass a page from search_strapi_docs (e.g. "cms/features/rbac") or a docs.strapi.io link. Long pages return their outline first; then read the section you need.',
    readOnly: true,
    parameters: Type.Object({
      page: Type.String({ description: 'The page from search_strapi_docs, e.g. "cms/features/internationalization", or a docs.strapi.io link.' }),
      section: Type.Optional(Type.String({ description: "A heading from the page's outline, to read only that section." })),
    }),
    execute: async ({ page, section }, ctx) => {
      const path = pagePath(page);
      if (!/^[a-z0-9][a-z0-9_/-]*$/i.test(path) || path.includes("//")) {
        return { text: `"${page}" isn't a Strapi docs page. Use a page from search_strapi_docs.`, isError: true };
      }
      let text: string;
      try {
        text = await loadPage(path, ctx.signal);
      } catch (error) {
        if (error instanceof DocsError && error.message === "not found") {
          return { text: `There is no Strapi docs page "${path}". Use search_strapi_docs to find one.`, isError: true };
        }
        return unreachable(error, (index?.docs ?? offline())?.find(path));
      }
      const url = `${base}/${path}`;
      return {
        text: `Source: ${url}\n\n${pageExcerpt(text, section)}`,
        ui: ui.actions([{ label: "Open in Strapi docs", kind: "link", href: url }]),
      };
    },
  });

  return [search, read];
}
