import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Turns text into vectors for semantic search, which finds passages that say the same thing in
 * other words: customers describe one problem many ways. Optional: keyword search works without it.
 */
export interface EmbeddingsAdapter {
  /** Names the model. Vectors from another model are never compared with its own. */
  id: string;
  /** One vector per text, in order. Queries and passages may be embedded differently (`purpose`). */
  embed(texts: string[], purpose: "query" | "document", signal?: AbortSignal): Promise<number[][]>;
}

export interface OpenAIEmbeddingsOptions {
  /** The API's base URL, e.g. "http://localhost:1234/v1" for LM Studio, "https://api.openai.com/v1". */
  baseUrl: string;
  model: string;
  apiKey?: string;
  /** Environment variable that holds the key. */
  apiKeyEnv?: string;
  /** Texts per request. Default 32. */
  batchSize?: number;
  /** Prepended to queries and passages, for models trained with them, such as nomic-embed-text: "search_query: " and "search_document: ". */
  queryPrefix?: string;
  documentPrefix?: string;
  /** Shorter vectors, for models that support it (OpenAI's text-embedding-3). */
  dimensions?: number;
  timeoutMs?: number;
  /** For tests. */
  fetch?: typeof fetch;
}

/** Embeddings from any OpenAI-compatible `/embeddings` endpoint: OpenAI, LM Studio, Ollama, vLLM, a gateway. */
export function openAIEmbeddings(options: OpenAIEmbeddingsOptions): EmbeddingsAdapter {
  const base = options.baseUrl.replace(/\/+$/, "");
  const batchSize = options.batchSize ?? 32;
  return {
    id: `${base}#${options.model}${options.dimensions ? `@${options.dimensions}` : ""}`,
    async embed(texts, purpose, signal) {
      const prefix = (purpose === "query" ? options.queryPrefix : options.documentPrefix) ?? "";
      const key = options.apiKey ?? (options.apiKeyEnv ? process.env[options.apiKeyEnv] : undefined);
      const vectors: number[][] = [];
      for (let i = 0; i < texts.length; i += batchSize) {
        const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000);
        const response = await (options.fetch ?? fetch)(`${base}/embeddings`, {
          method: "POST",
          headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
          body: JSON.stringify({
            model: options.model,
            input: texts.slice(i, i + batchSize).map((text) => prefix + text),
            ...(options.dimensions ? { dimensions: options.dimensions } : {}),
          }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok) throw new Error(`the embeddings endpoint answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
        const body = (await response.json()) as { data?: { index?: number; embedding: number[] }[] };
        const data = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
        if (data.length !== Math.min(batchSize, texts.length - i)) throw new Error("the embeddings endpoint returned the wrong number of vectors");
        vectors.push(...data.map((item) => item.embedding));
      }
      return vectors;
    },
  };
}

/** Passages longer than this are embedded by their start; models read a few thousand tokens at most. */
const MAX_EMBED_CHARS = 4_000;
/** Semantic matches count when they are at least this similar, relative to the best one. */
const CLOSE_ENOUGH = 0.85;
const MAX_SEMANTIC = 20;

function unit(vector: ArrayLike<number>): Float32Array {
  const out = Float32Array.from(vector);
  let norm = 0;
  for (const value of out) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < out.length; i++) out[i]! /= norm;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

const hash = (text: string) => createHash("sha256").update(text).digest("base64url").slice(0, 24);

/**
 * Vectors for passages, kept by a hash of their text so only new or changed passages are embedded,
 * and saved in `dir` when there is one, so a restart doesn't embed everything again.
 */
export class VectorStore {
  readonly adapter: EmbeddingsAdapter;
  private vectors = new Map<string, Float32Array>();
  private loaded?: Promise<void>;
  private readonly file?: string;

  constructor(adapter: EmbeddingsAdapter, dir?: string) {
    this.adapter = adapter;
    this.file = dir ? path.join(dir, `embeddings-${hash(adapter.id).slice(0, 12)}.json`) : undefined;
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      if (!this.file) return;
      try {
        const saved = JSON.parse(await readFile(this.file, "utf8")) as { model: string; vectors: Record<string, string> };
        if (saved.model !== this.adapter.id) return;
        for (const [key, value] of Object.entries(saved.vectors)) {
          const bytes = Buffer.from(value, "base64");
          this.vectors.set(key, new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
        }
      } catch {
        // Nothing saved yet, or a damaged file: embed again.
      }
    })();
    return this.loaded;
  }

  /** Embeds the texts it has no vector for, `progress` reporting how many are left. Keeps only these texts' vectors. */
  async index(texts: string[], signal?: AbortSignal, progress?: (done: number, total: number) => void): Promise<void> {
    await this.load();
    const wanted = new Map(texts.map((text) => [hash(text.slice(0, MAX_EMBED_CHARS)), text.slice(0, MAX_EMBED_CHARS)]));
    const missing = [...wanted].filter(([key]) => !this.vectors.has(key));
    const step = 64;
    for (let i = 0; i < missing.length; i += step) {
      progress?.(i, missing.length);
      const batch = missing.slice(i, i + step);
      const vectors = await this.adapter.embed(batch.map(([, text]) => text), "document", signal);
      batch.forEach(([key], n) => this.vectors.set(key, unit(vectors[n]!)));
    }
    for (const key of this.vectors.keys()) if (!wanted.has(key)) this.vectors.delete(key);
    if (missing.length) await this.save();
  }

  /**
   * The texts closest to the query, the closest first: those within reach of the best match, since every passage
   * is somewhat similar to every query. Texts without a vector are left out.
   */
  async rank(query: string, texts: { key: string; text: string }[], signal?: AbortSignal): Promise<string[]> {
    const [vector] = await this.adapter.embed([query], "query", signal);
    const q = unit(vector!);
    const ranked = texts
      .map(({ key, text }) => {
        const v = this.vectors.get(hash(text.slice(0, MAX_EMBED_CHARS)));
        return { key, similarity: v && v.length === q.length ? dot(q, v) : -Infinity };
      })
      .filter(({ similarity }) => similarity > -Infinity)
      .sort((a, b) => b.similarity - a.similarity);
    const best = ranked[0]?.similarity ?? 0;
    if (best <= 0) return [];
    return ranked
      .filter(({ similarity }) => similarity >= best * CLOSE_ENOUGH)
      .slice(0, MAX_SEMANTIC)
      .map(({ key }) => key);
  }

  private async save(): Promise<void> {
    if (!this.file) return;
    const vectors = Object.fromEntries([...this.vectors].map(([key, v]) => [key, Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64")]));
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify({ model: this.adapter.id, vectors }));
    await rename(temporary, this.file);
  }
}
