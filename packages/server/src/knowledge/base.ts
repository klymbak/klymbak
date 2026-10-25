import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentUser, Logger } from "../types.ts";
import { VectorStore, type EmbeddingsAdapter } from "./embeddings.ts";
import { passages, KnowledgeIndex, type Hit, type Passage } from "./search.ts";
import { pagePath } from "./sources.ts";
import type { TableData } from "./table.ts";
import { STOPWORDS, synonymMap } from "./text.ts";
import type { KnowledgeDocument, KnowledgeSource, SourceContent } from "./types.ts";

/** While a source can't be reached, try it again after this long. */
const RETRY_MS = 10 * 60_000;
/** A source that has never loaded is tried again sooner. */
const ERROR_RETRY_MS = 30_000;
const READ_TTL_MS = 24 * 60 * 60_000;
const MAX_CACHED_READS = 40;

interface SourceState {
  content?: SourceContent;
  /** The date of the saved or shipped copy in use while the source can't be reached. */
  offline?: string;
  /** Why nothing could be loaded. */
  error?: string;
  nextLoad: number;
  loading?: Promise<void>;
}

export interface KnowledgeBaseOptions {
  embeddings?: EmbeddingsAdapter;
  /** Where copies of remote sources and embeddings are kept between restarts. */
  cacheDir?: string;
  synonyms?: Record<string, string[]>;
  /** Words to leave out of searches besides common English ones, such as the product's own name. */
  stopwords?: string[];
}

export interface Progress {
  signal?: AbortSignal;
  logger?: Logger;
  progress?(text: string): void;
}

export interface SearchResult {
  hits: Hit[];
  /** Terms to pick snippets by. */
  terms: Set<string>;
  notes: string[];
  /** Every source searched failed to load. */
  failed: boolean;
}

/** Sources, loaded on first use and refreshed when stale, with one index over all of them. */
export class KnowledgeBase {
  readonly sources: KnowledgeSource[];
  private readonly states = new Map<string, SourceState>();
  private index?: KnowledgeIndex;
  private indexed = -1;
  private version = 0;
  private readonly vectors?: VectorStore;
  private vectorsIndexed = -1;
  private semanticError?: { message: string; at: number };
  private readonly reads = new Map<string, { text: string; at: number }>();
  private readonly synonyms: Map<string, string[]>;
  private readonly stopwords: ReadonlySet<string>;
  private readonly options: KnowledgeBaseOptions;

  constructor(sources: KnowledgeSource[], options: KnowledgeBaseOptions = {}) {
    this.options = options;
    const seen = new Set<string>();
    for (const source of sources) {
      if (seen.has(source.name)) throw new Error(`Two knowledge sources are named "${source.name}". Give one a different name.`);
      seen.add(source.name);
      this.states.set(source.name, { nextLoad: 0 });
    }
    this.sources = sources;
    this.synonyms = synonymMap(options.synonyms);
    this.stopwords = options.stopwords?.length ? new Set([...STOPWORDS, ...options.stopwords.map((word) => word.toLowerCase())]) : STOPWORDS;
    this.vectors = options.embeddings ? new VectorStore(options.embeddings, options.cacheDir) : undefined;
  }

  /** The sources this person may use. */
  sourcesFor(user: AgentUser): KnowledgeSource[] {
    return this.sources.filter((source) => !source.roles?.length || source.roles.some((role) => user.roles.includes(role)));
  }

  source(name: string): KnowledgeSource | undefined {
    return this.sources.find((source) => source.name === name);
  }

  state(name: string): Readonly<SourceState> | undefined {
    return this.states.get(name);
  }

  /** Loads the sources that are stale, then brings the index (and the vectors) up to date. */
  async ready(sources: readonly KnowledgeSource[], ctx: Progress = {}): Promise<KnowledgeIndex> {
    const stale = sources.filter((source) => Date.now() >= this.states.get(source.name)!.nextLoad);
    if (stale.some((source) => !this.states.get(source.name)!.content)) ctx.progress?.(`Loading ${stale.map((source) => source.title).join(", ")}…`);
    await Promise.all(stale.map((source) => this.load(source, ctx)));
    if (!this.index || this.indexed !== this.version) {
      this.indexed = this.version;
      this.index = new KnowledgeIndex(
        this.sources.flatMap((source) => (this.states.get(source.name)!.content?.documents ?? []).map((document) => passages(source.name, document)).flat()),
        { synonyms: this.synonyms, stopwords: this.stopwords, boost: (passage) => this.source(passage.source)?.boost?.(passage.document) ?? 1 },
      );
    }
    await this.embed(ctx);
    return this.index;
  }

  private load(source: KnowledgeSource, ctx: Progress): Promise<void> {
    const state = this.states.get(source.name)!;
    state.loading ??= (async () => {
      try {
        const content = await source.load({ signal: ctx.signal, logger: ctx.logger });
        Object.assign(state, { content, offline: undefined, error: undefined, nextLoad: source.refreshMs ? Date.now() + source.refreshMs : Infinity });
        if (source.remote) await this.saveCopy(source, content).catch((error) => ctx.logger?.warn(`Knowledge: couldn't save a copy of ${source.title}`, message(error)));
      } catch (error) {
        ctx.logger?.warn(`Knowledge: couldn't load ${source.title}`, message(error));
        state.nextLoad = Date.now() + RETRY_MS;
        // An older load of its own beats a saved copy, and a saved copy beats one shipped with the app.
        if (state.content) return;
        const copy = (await this.readCopy(source)) ?? (await source.fallback?.().catch(() => undefined));
        if (!copy) {
          Object.assign(state, { error: message(error), nextLoad: Date.now() + ERROR_RETRY_MS });
          return;
        }
        Object.assign(state, { content: copy, offline: copy.fetched ?? "an earlier date", error: undefined });
      } finally {
        state.loading = undefined;
      }
      this.version++;
    })();
    return state.loading;
  }

  private copyFile(source: KnowledgeSource): string | undefined {
    return this.options.cacheDir ? path.join(this.options.cacheDir, `${source.name}.json`) : undefined;
  }

  private async saveCopy(source: KnowledgeSource, content: SourceContent): Promise<void> {
    const file = this.copyFile(source);
    if (!file) return;
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ fetched: new Date().toISOString().slice(0, 10), content }));
    await rename(temporary, file);
  }

  private async readCopy(source: KnowledgeSource): Promise<(SourceContent & { fetched: string }) | undefined> {
    const file = source.remote ? this.copyFile(source) : undefined;
    if (!file) return undefined;
    try {
      const saved = JSON.parse(await readFile(file, "utf8")) as { fetched: string; content: SourceContent };
      return { ...saved.content, fetched: saved.fetched };
    } catch {
      return undefined;
    }
  }

  /** Passages for semantic search: those of sources that don't opt out. */
  private embeddable(): Passage[] {
    return (this.index?.passages ?? []).filter((passage) => this.source(passage.source)?.embed !== false);
  }

  private async embed(ctx: Progress): Promise<void> {
    if (!this.vectors || this.vectorsIndexed === this.indexed) return;
    if (this.semanticError && Date.now() - this.semanticError.at < RETRY_MS) return;
    const list = this.embeddable();
    try {
      await this.vectors.index(list.map(embeddingText), ctx.signal, (done, total) => ctx.progress?.(`Indexing passages for semantic search: ${done} of ${total}…`));
      this.vectorsIndexed = this.indexed;
      this.semanticError = undefined;
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      this.semanticError = { message: message(error), at: Date.now() };
      ctx.logger?.warn("Knowledge: embedding passages failed; searching by keywords only", message(error));
    }
  }

  async search(query: string, sources: readonly KnowledgeSource[], options: Progress & { limit?: number }): Promise<SearchResult> {
    const index = await this.ready(sources, options);
    const names = new Set(sources.map((source) => source.name));
    const notes: string[] = [];
    for (const source of sources) {
      const state = this.states.get(source.name)!;
      if (state.error) notes.push(`Couldn't load ${source.title}: ${state.error}.`);
      else if (state.offline) notes.push(`${source.title} can't be reached, so this searched a saved copy from ${state.offline}; reading its documents may fail too.`);
    }
    let semantic: string[] | undefined;
    if (this.vectors && this.vectorsIndexed === this.indexed) {
      try {
        const candidates = this.embeddable().filter((passage) => names.has(passage.source));
        semantic = await this.vectors.rank(query, candidates.map((passage) => ({ key: passage.key, text: embeddingText(passage) })), options.signal);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        notes.push(`Semantic search is unavailable (${message(error)}), so these are keyword matches only.`);
      }
    } else if (this.vectors && this.semanticError) {
      notes.push(`Semantic search is unavailable (${this.semanticError.message}), so these are keyword matches only.`);
    }
    const hits = index.search(query, { limit: options.limit, filter: (passage) => names.has(passage.source), semantic });
    const failed = sources.every((source) => this.states.get(source.name)!.error);
    return { hits, terms: index.queryTerms(query), notes, failed };
  }

  /** The document a reference means: "<source>:<id>", an id, or a link to it. */
  find(reference: string, sources: readonly KnowledgeSource[]): { source: KnowledgeSource; document: KnowledgeDocument } | undefined {
    const trimmed = reference.trim().replace(/#\d+$/, "");
    const candidates = sources.flatMap((source) => (this.states.get(source.name)?.content?.documents ?? []).map((document) => ({ source, document })));
    const colon = trimmed.indexOf(":");
    if (colon > 0 && !/^https?:/i.test(trimmed)) {
      const [name, id] = [trimmed.slice(0, colon), trimmed.slice(colon + 1)];
      const found = candidates.find((c) => c.source.name === name && c.document.id === id);
      if (found) return found;
    }
    const byId = candidates.filter((c) => c.document.id === trimmed);
    if (byId.length === 1) return byId[0];
    const wanted = pagePath(trimmed);
    if (!wanted) return undefined;
    const byLink = candidates.filter((c) => (c.document.url && pagePath(c.document.url) === wanted) || pagePath(c.document.id) === wanted);
    return byLink.length === 1 ? byLink[0] : undefined;
  }

  /** A document's text: its own, or read from its source and kept for a day. */
  async text(source: KnowledgeSource, document: KnowledgeDocument, ctx: Progress): Promise<string | undefined> {
    if (document.text !== undefined || !source.read) return document.text;
    const key = `${source.name}:${document.id}`;
    const cached = this.reads.get(key);
    if (cached && Date.now() - cached.at < READ_TTL_MS) return cached.text;
    const text = await source.read(document, { signal: ctx.signal, logger: ctx.logger });
    this.reads.delete(key);
    this.reads.set(key, { text, at: Date.now() });
    if (this.reads.size > MAX_CACHED_READS) this.reads.delete(this.reads.keys().next().value!);
    return text;
  }

  table(name: string): TableData | undefined {
    return this.states.get(name)?.content?.table;
  }
}

/** What a passage is embedded as: where it is, then what it says. */
function embeddingText(passage: Passage): string {
  const where = [passage.document.title, ...passage.path].join(" › ");
  return `${where}\n\n${passage.text || passage.document.summary || ""}`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
