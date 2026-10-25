import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { humanize } from "@klymbak/protocol";
import { parseFrontmatter } from "../skills.ts";
import { decodeEntities, htmlTitle, htmlToMarkdown } from "./markdown.ts";
import { ticketMarkdown, type KnowledgeTicket, type RedactOptions } from "./redact.ts";
import { fromRecords, parseCsv, readXlsx, rowLine, type TableData } from "./table.ts";
import type { KnowledgeDocument, KnowledgeSource, SourceContent, SourceContext } from "./types.ts";

const DAY = 24 * 60 * 60_000;
const TIMEOUT_MS = 15_000;
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

interface CommonOptions {
  /** Names the source in document ids and the `source` filter. Default: from the folder, site or file. */
  name?: string;
  /** For people and the model. Default: from the name. */
  title?: string;
  /** What it holds and when to use it, for the model. */
  description?: string;
  /** Only people with one of these roles search and read it. */
  roles?: string[];
  /** false leaves it out of semantic search. */
  embed?: boolean;
  /** Multiplies a document's score: above 1 to favor it, below to demote it. */
  boost?(document: KnowledgeDocument): number;
}

/** A source's name from a path or a host: "./kb/help-center" → "help-center", "docs.example.com" → "docs-example-com". */
function nameFrom(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "knowledge";
}

function common(options: CommonOptions, name: string): Pick<KnowledgeSource, "name" | "title" | "description" | "roles" | "embed" | "boost"> {
  if (!NAME.test(name)) throw new Error(`Knowledge source "${name}": the name must be lowercase letters, digits and single hyphens.`);
  return { name, title: options.title ?? humanize(name), description: options.description, roles: options.roles, embed: options.embed, boost: options.boost };
}

async function fetchText(url: string, ctx: SourceContext & { fetch?: typeof fetch; accept?: string }): Promise<{ text: string; type: string }> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const response = await (ctx.fetch ?? fetch)(url, {
    headers: { accept: ctx.accept ?? "text/markdown, text/plain;q=0.9, text/html;q=0.8" },
    signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout,
  });
  if (response.status === 404) throw new SourceError("not found", 404);
  if (!response.ok) throw new SourceError(`the server answered ${response.status}`, response.status);
  return { text: await response.text(), type: response.headers.get("content-type") ?? "" };
}

export class SourceError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export interface FolderOptions extends CommonOptions {
  /** Links citations to where the files are published: the base URL, then the file's path without its extension. */
  baseUrl?: string;
}

const DOCUMENT_FILES = new Set([".md", ".markdown", ".mdx", ".txt", ".html", ".htm", ".pdf"]);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_DEPTH = 6;

/** Markdown and HTML documents, text files and PDFs in a folder and its subfolders. Read once, so edits need a restart. */
function folder(dir: string, options: FolderOptions = {}): KnowledgeSource {
  const root = path.resolve(dir);
  return {
    ...common(options, options.name ?? nameFrom(path.basename(root))),
    async load() {
      const files = await listFiles(root).catch((error: Error) => {
        throw new Error(`can't read the folder ${root}: ${error.message}`);
      });
      const documents: KnowledgeDocument[] = [];
      for (const file of files) {
        const id = path.relative(root, file).split(path.sep).join("/");
        const url = options.baseUrl ? new URL(id.replace(/(^|\/)index\.[a-z]+$/i, "$1").replace(/\.[a-z]+$/i, ""), options.baseUrl.replace(/\/?$/, "/")).href : undefined;
        documents.push(await readDocument(file, id, url));
      }
      return { documents };
    },
  };
}

async function listFiles(dir: string, depth = 0): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth < MAX_DEPTH) files.push(...(await listFiles(full, depth + 1)));
    else if (entry.isFile() && DOCUMENT_FILES.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;
const fileTitle = (file: string) => humanize(path.basename(file, path.extname(file)));
const list = (value: string | undefined) => value?.replace(/^\[|\]$/g, "").split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

async function readDocument(file: string, id: string, url: string | undefined): Promise<KnowledgeDocument> {
  const extension = path.extname(file).toLowerCase();
  const size = (await stat(file)).size;
  if (size > (extension === ".pdf" ? MAX_PDF_BYTES : MAX_TEXT_BYTES)) throw new Error(`${file} is too large to index (${Math.round(size / 1024 / 1024)} MB).`);
  if (extension === ".pdf") {
    const { title, pages } = await readPdf(await readFile(file), file);
    return { id, url, title: title ?? fileTitle(file), text: pages.map((page, i) => `## Page ${i + 1}\n\n${page.trim()}`).join("\n\n") };
  }
  const raw = (await readFile(file, "utf8")).replace(/\r\n/g, "\n");
  if (extension === ".html" || extension === ".htm") {
    return { id, url, title: htmlTitle(raw) ?? fileTitle(file), text: htmlToMarkdown(raw, url) };
  }
  const match = FRONTMATTER.exec(raw);
  const fields = match ? parseFrontmatter(match[1]!) : {};
  const text = (match ? raw.slice(match[0].length) : raw).trim();
  const heading = extension === ".txt" ? undefined : /^#\s+(.+?)\s*#*\s*$/m.exec(text)?.[1];
  return {
    id,
    url: fields.url ?? url,
    title: fields.title ?? heading ?? fileTitle(file),
    summary: fields.description ?? fields.summary,
    keywords: list(fields.keywords ?? fields.tags),
    updatedAt: fields.updated ?? fields.date,
    text,
  };
}

/** A PDF's pages as text, through the optional `unpdf` package. */
async function readPdf(data: Uint8Array, file: string): Promise<{ title?: string; pages: string[] }> {
  let unpdf: typeof import("unpdf");
  try {
    unpdf = await import("unpdf");
  } catch {
    throw new Error(`Reading ${path.basename(file)} needs the unpdf package: npm install unpdf`);
  }
  const pdf = await unpdf.getDocumentProxy(new Uint8Array(data));
  try {
    const [{ text }, meta] = await Promise.all([unpdf.extractText(pdf, { mergePages: false }), unpdf.getMeta(pdf).catch(() => undefined)]);
    const title = (meta?.info as { Title?: unknown } | undefined)?.Title;
    return { title: typeof title === "string" && title.trim() ? title.trim() : undefined, pages: text };
  } finally {
    await pdf.loadingTask.destroy();
  }
}

// ---------------------------------------------------------------------------
// llms.txt
// ---------------------------------------------------------------------------

export interface LlmsTxtOptions extends CommonOptions {
  /** Index every page's full text from the site's llms-full.txt, or from this URL. Without one, titles and summaries are searched and pages are fetched when read. Default true. */
  full?: boolean | string;
  /** Tidies a page's Markdown before it is indexed or read: site-specific leftovers. */
  clean?(markdown: string, url: string): string;
  /** An llms.txt to search while the site can't be reached and nothing was fetched before, such as a copy shipped with your app. */
  fallback?: { text: string; fetched?: string };
  /** Default: a day. */
  refreshMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** "https://docs.example.com/guides/setup.md#install" → "guides/setup" */
export function pagePath(reference: string): string {
  return reference
    .trim()
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/[#?].*$/, "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\.(md|html?)$/i, "");
}

/** Parses an llms.txt index: "- [Title](https://docs.example.com/page.md): Summary". */
export function parseLlmsTxt(text: string): { title: string; link: string; summary: string }[] {
  const pages: { title: string; link: string; summary: string }[] = [];
  for (const line of text.split("\n")) {
    const match = /^-\s*\[([^\]]+)\]\(([^)\s]+)\)(?::\s*(.*))?$/.exec(line.trim());
    if (match && pagePath(match[2]!)) pages.push({ title: match[1]!.trim(), link: match[2]!, summary: (match[3] ?? "").trim() });
  }
  return pages;
}

/** Splits an llms-full.txt into pages: each starts with "# Title" and a "Source: <url>" line. Text before the first page is left out. */
export function parseLlmsFullTxt(text: string): { title: string; url: string; text: string }[] {
  const starts = [...text.replace(/\r\n/g, "\n").matchAll(/^# (.+)\n(?:> )?Source: (\S+)[ \t]*$/gm)];
  return starts.map((match, i) => ({
    title: match[1]!.trim(),
    url: match[2]!,
    text: text.slice(match.index! + match[0].length, starts[i + 1]?.index ?? text.length).trim(),
  }));
}

/**
 * A documentation site's llms.txt (llmstxt.org): its pages' titles and summaries, and with `full`
 * their text from llms-full.txt, searched in this process. Nothing from the conversation is sent.
 */
function llmsTxt(url: string, options: LlmsTxtOptions = {}): KnowledgeSource {
  const origin = new URL(url).origin;
  const fullUrl = options.full === false ? undefined : typeof options.full === "string" ? options.full : url.replace(/llms\.txt(?=$|[?#])/, "llms-full.txt");
  const markdownLinks = new Map<string, string>();
  const clean = (markdown: string, page: string) => (options.clean ? options.clean(markdown, page) : markdown).trim();
  const toDocuments = (index: string, full?: string): KnowledgeDocument[] => {
    const texts = new Map<string, { title: string; text: string; url: string }>();
    for (const page of full ? parseLlmsFullTxt(full) : []) texts.set(pagePath(page.url), page);
    const documents = parseLlmsTxt(index).map(({ title, link, summary }) => {
      const id = pagePath(link);
      markdownLinks.set(id, new URL(link, origin).href);
      const page = texts.get(id);
      texts.delete(id);
      const human = new URL(link, origin).href.replace(/\.md(?=$|[?#])/, "");
      return { id, title, summary: summary || undefined, url: human, text: page ? clean(page.text, human) : undefined };
    });
    // Pages that llms-full.txt has and the index doesn't.
    for (const [id, page] of texts) documents.push({ id, title: page.title, url: page.url, summary: undefined, text: clean(page.text, page.url) });
    return documents.filter((document, i, all) => all.findIndex((other) => other.id === document.id) === i);
  };
  return {
    ...common(options, options.name ?? nameFrom(new URL(url).hostname)),
    remote: true,
    refreshMs: options.refreshMs ?? DAY,
    async load(ctx) {
      const [index, full] = await Promise.all([
        fetchText(url, { ...ctx, fetch: options.fetch, accept: "text/plain, text/markdown" }),
        fullUrl ? fetchText(fullUrl, { ...ctx, fetch: options.fetch, accept: "text/plain, text/markdown" }).catch(() => undefined) : undefined,
      ]);
      const documents = toDocuments(index.text, full?.text);
      if (!documents.length) throw new SourceError(`its page index (${url}) was empty`);
      return { documents };
    },
    async read(document, ctx) {
      const link = markdownLinks.get(document.id) ?? `${origin}/${document.id}.md`;
      const page = await fetchText(link, { ...ctx, fetch: options.fetch });
      const markdown = /html/i.test(page.type) ? htmlToMarkdown(page.text, link) : page.text;
      return clean(markdown, document.url ?? link);
    },
    fallback: options.fallback
      ? async () => ({ documents: toDocuments(options.fallback!.text), fetched: options.fallback!.fetched })
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Sitemaps
// ---------------------------------------------------------------------------

export interface SitemapOptions extends CommonOptions {
  /** Only pages whose URL this matches. */
  include?: RegExp | ((url: string) => boolean);
  exclude?: RegExp | ((url: string) => boolean);
  /** At most this many pages. Default 500. */
  maxPages?: number;
  /** Pages fetched at a time. Default 4. */
  concurrency?: number;
  /** Default: a day. */
  refreshMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

const matches = (filter: RegExp | ((url: string) => boolean), url: string) => (filter instanceof RegExp ? filter.test(url) : filter(url));

/** A website's pages from its sitemap.xml (sitemap indexes followed): each page's main content as Markdown, split by its headings. */
function sitemap(url: string, options: SitemapOptions = {}): KnowledgeSource {
  const site = new URL(url);
  return {
    ...common(options, options.name ?? nameFrom(site.hostname)),
    remote: true,
    refreshMs: options.refreshMs ?? DAY,
    async load(ctx) {
      const pages = new Map<string, string | undefined>();
      const queue = [url];
      for (let fetched = 0; queue.length && fetched < 20; fetched++) {
        const xml = (await fetchText(queue.shift()!, { ...ctx, fetch: options.fetch, accept: "application/xml, text/xml" })).text;
        const nested = /<sitemapindex\b/i.test(xml);
        for (const [, entry] of xml.matchAll(/<(?:url|sitemap)\b[^>]*>([\s\S]*?)<\/(?:url|sitemap)>/gi)) {
          const loc = /<loc>\s*([\s\S]*?)\s*<\/loc>/i.exec(entry!)?.[1];
          if (!loc) continue;
          const page = decodeEntities(loc.replace(/^<!\[CDATA\[|\]\]>$/g, ""));
          if (nested) queue.push(page);
          else if ((!options.include || matches(options.include, page)) && !(options.exclude && matches(options.exclude, page))) {
            pages.set(page, /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(entry!)?.[1]);
          }
        }
      }
      const wanted = [...pages].slice(0, options.maxPages ?? 500);
      if (!wanted.length) throw new SourceError(`its sitemap (${url}) lists no pages`);
      const documents: KnowledgeDocument[] = [];
      let failures = 0;
      let next = 0;
      const worker = async () => {
        while (next < wanted.length) {
          const [page, lastmod] = wanted[next++]!;
          try {
            const { text, type } = await fetchText(page, { ...ctx, fetch: options.fetch, accept: "text/html, text/markdown;q=0.9" });
            const html = /html/i.test(type) || /^\s*</.test(text);
            const markdown = html ? htmlToMarkdown(text, page) : text;
            const title = (html ? htmlTitle(text) : undefined) ?? /^#\s+(.+)$/m.exec(markdown)?.[1] ?? page;
            const address = new URL(page);
            const id = address.host === site.host ? `${address.pathname.replace(/^\/+|\/+$/g, "") || "index"}${address.search}` : page;
            documents.push({ id, title, url: page, text: markdown, updatedAt: lastmod });
          } catch (error) {
            failures++;
            ctx.logger?.warn(`Knowledge: couldn't fetch ${page}`, error instanceof Error ? error.message : error);
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, wanted.length) }, worker));
      if (!documents.length) throw new SourceError(`none of its ${failures} pages could be fetched`);
      return { documents: documents.sort((a, b) => a.id.localeCompare(b.id)) };
    },
  };
}

// ---------------------------------------------------------------------------
// Documents from code, resolved tickets
// ---------------------------------------------------------------------------

export interface DocumentsOptions extends CommonOptions {
  name: string;
  /** Your documents: helpdesk articles, wiki pages, product descriptions. Give `html` instead of `text` and it's converted. */
  load(): Promise<(Omit<KnowledgeDocument, "id"> & { id: string | number; html?: string })[]>;
  /** How long a load stays fresh. Default: an hour. */
  refreshMs?: number;
}

/** Documents your code loads: a helpdesk's articles, a wiki, a CMS. */
function documents(options: DocumentsOptions): KnowledgeSource {
  return {
    ...common(options, options.name),
    refreshMs: options.refreshMs ?? 60 * 60_000,
    async load() {
      const loaded = await options.load();
      return {
        documents: loaded.map(({ html, ...document }) => ({
          ...document,
          id: String(document.id),
          text: document.text ?? (html ? htmlToMarkdown(html, document.url) : undefined),
        })),
      };
    },
  };
}

export interface TicketsOptions extends CommonOptions {
  /** Your resolved tickets. Their customers' details are removed before they are indexed. */
  load(): Promise<KnowledgeTicket[]>;
  /** How customers' details are removed, or false to keep them (then limit the source with `roles`). Default: removed. */
  redact?: boolean | RedactOptions;
  /** How long a load stays fresh. Default: an hour. */
  refreshMs?: number;
}

/**
 * Resolved tickets, to see how a problem was handled before. Each ticket's customer (name, email,
 * phone, address and the values in `private`) and any emails, phone and card numbers are replaced
 * with placeholders before the ticket is indexed, so neither search nor the model ever sees them.
 */
function tickets(options: TicketsOptions): KnowledgeSource {
  const redact = options.redact === false ? false : options.redact === true || options.redact === undefined ? {} : options.redact;
  return {
    ...common(
      {
        title: "Resolved tickets",
        description: "How past customer tickets were resolved, with customers' details removed. Use it to see how a similar problem was handled before.",
        ...options,
      },
      options.name ?? "tickets",
    ),
    refreshMs: options.refreshMs ?? 60 * 60_000,
    async load() {
      const loaded = await options.load();
      return {
        documents: loaded.map((ticket) => {
          const { title, text } = ticketMarkdown(ticket, redact);
          return { id: String(ticket.id), title, text, url: ticket.url, keywords: ticket.tags, updatedAt: ticket.closedAt };
        }),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface TableOptions extends CommonOptions {
  name: string;
  /** What the table holds and what it answers, for the model: "Which footprints, rainflies and poles fit which tents". */
  description: string;
  /** A CSV, TSV or .xlsx file. */
  file?: string;
  /** A CSV or .xlsx to download, such as a Google Sheet's export link (…/export?format=csv). */
  url?: string;
  /** Rows from your code: objects whose keys are the columns. */
  rows?(): Promise<Record<string, unknown>[]>;
  /** The workbook's sheet. Default: the first. */
  sheet?: string;
  /** The CSV's delimiter. Default: guessed from the header line. */
  delimiter?: string;
  /** How long a load stays fresh. Default: loaded once for a file, an hour otherwise. */
  refreshMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** Rows indexed per document for search; lookups read the whole table. */
const ROWS_PER_DOCUMENT = 25;
const MAX_INDEXED_ROWS = 5_000;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString().replace(/T00:00:00\.000Z$/, "");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** The table as documents for search: its rows, a line each, in groups. */
export function tableDocuments(source: { title: string; description?: string }, table: TableData): KnowledgeDocument[] {
  const documents: KnowledgeDocument[] = [];
  const rows = table.rows.slice(0, MAX_INDEXED_ROWS);
  for (let start = 0; start < Math.max(rows.length, 1); start += ROWS_PER_DOCUMENT) {
    const chunk = rows.slice(start, start + ROWS_PER_DOCUMENT);
    documents.push({
      id: `rows-${start + 1}-${start + chunk.length}`,
      title: source.title,
      summary: start === 0 ? [source.description, `Columns: ${table.columns.join(", ")}.`].filter(Boolean).join(" ") : undefined,
      text: chunk.map((row) => rowLine(row, table.columns)).join("\n"),
    });
  }
  return documents;
}

/** A table of facts, looked up by column: a CSV or spreadsheet file, a download link, or rows from your code. */
function table(options: TableOptions): KnowledgeSource {
  const ways = [options.file, options.url, options.rows].filter(Boolean).length;
  if (ways !== 1) throw new Error(`Knowledge table "${options.name}": give one of file, url or rows.`);
  if (!options.description?.trim()) throw new Error(`Knowledge table "${options.name}": a description is required. Say what the table answers.`);
  const parse = (data: Uint8Array, where: string, type = "") => {
    const xlsx = /\.xlsx$/i.test(where) || /spreadsheetml/i.test(type) || (data[0] === 0x50 && data[1] === 0x4b);
    try {
      return xlsx ? readXlsx(data, options.sheet) : parseCsv(new TextDecoder().decode(data), options.delimiter ?? (/\.tsv$/i.test(where) ? "\t" : undefined));
    } catch (error) {
      throw new Error(`can't read ${where}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  const source: KnowledgeSource = {
    ...common(options, options.name),
    kind: "table",
    remote: Boolean(options.url),
    refreshMs: options.refreshMs ?? (options.file ? undefined : 60 * 60_000),
    async load(ctx): Promise<SourceContent> {
      let data: TableData;
      if (options.file) {
        data = parse(new Uint8Array(await readFile(options.file)), options.file);
      } else if (options.url) {
        const timeout = AbortSignal.timeout(TIMEOUT_MS);
        const response = await (options.fetch ?? fetch)(options.url, { signal: ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout });
        if (!response.ok) throw new SourceError(`the server answered ${response.status}`, response.status);
        data = parse(new Uint8Array(await response.arrayBuffer()), options.url, response.headers.get("content-type") ?? "");
      } else {
        const rows = await options.rows!();
        const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
        data = fromRecords([columns, ...rows.map((row) => columns.map((column) => cellText(row[column])))]);
      }
      return { table: data, documents: tableDocuments(source, data) };
    },
  };
  return source;
}

/** Where knowledge comes from, for `knowledgeTools({ sources })`. */
export const knowledge = { folder, llmsTxt, sitemap, documents, tickets, table };
