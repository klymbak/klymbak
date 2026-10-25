import type { Logger } from "../types.ts";
import type { TableData } from "./table.ts";

/** One document of a knowledge source: a page, a file, an article, a ticket. */
export interface KnowledgeDocument {
  /** Unique in its source and stable across loads: a file's path, an article's id, a page's path. */
  id: string;
  title: string;
  /** Where people can read it, shown as a link on its citations. */
  url?: string;
  /** A one-line description, scored next to the title (llms.txt gives one per page). */
  summary?: string;
  /**
   * The text in Markdown: headings split it into the sections that search returns. Leave it out when the source
   * reads documents on demand (see `KnowledgeSource.read`).
   */
  text?: string;
  /** Words that should find it besides its text: tags, product names, error codes. */
  keywords?: string[];
  updatedAt?: string;
}

/** What a source loads. A table source loads `table`; the knowledge base indexes its rows for search too. */
export interface SourceContent {
  documents: KnowledgeDocument[];
  table?: TableData;
}

export interface SourceContext {
  signal?: AbortSignal;
  logger?: Logger;
}

/**
 * Where knowledge comes from. The `knowledge` builders make the common ones (folders, llms.txt, sitemaps, documents
 * from your code, resolved tickets, tables); anything with a `load` works.
 */
export interface KnowledgeSource {
  /** Names it in document ids and in the `source` filter: lowercase letters, digits and single hyphens. */
  name: string;
  /** For people and the model: "Help center", "Resolved tickets". */
  title: string;
  /** What it holds and when to use it, for the model. Required for tables, whose lookups depend on it. */
  description?: string;
  /** A table answers lookups by column (`lookup_<name>`) besides being searched. */
  kind?: "documents" | "table";
  /** Only people with one of these roles search and read it. Default: everyone who has the tools. */
  roles?: string[];
  /** How long a load stays fresh. Default: loaded once. */
  refreshMs?: number;
  /** Fetched over the network: a copy of the last good load is kept in `cacheDir` and used while it can't be reached. */
  remote?: boolean;
  /** Leave its passages out of semantic search when embeddings are on. */
  embed?: boolean;
  /** Multiplies a document's score: above 1 to favor it, below to demote it. */
  boost?(document: KnowledgeDocument): number;
  load(ctx: SourceContext): Promise<SourceContent>;
  /** A document's text when it was listed without one, fetched when the model reads it. */
  read?(document: KnowledgeDocument, ctx: SourceContext): Promise<string>;
  /** Content to use while the source can't be loaded and nothing was loaded before, such as a copy shipped with the app. */
  fallback?(): Promise<(SourceContent & { fetched?: string }) | undefined>;
}
