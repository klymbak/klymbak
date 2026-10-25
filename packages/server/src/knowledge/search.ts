import { splitSections } from "./markdown.ts";
import { STOPWORDS, tokenize } from "./text.ts";
import type { KnowledgeDocument } from "./types.ts";

/** A section of a document, or part of a long one: what search returns. */
export interface Passage {
  /** Unique across the knowledge base: "<source>:<document id>#<n>". */
  key: string;
  source: string;
  document: KnowledgeDocument;
  /** The headings above it, without the document's title. Empty for the intro. */
  path: string[];
  text: string;
}

/** A document's passages: its sections, or one passage with its title and summary when it has no text yet. */
export function passages(source: string, document: KnowledgeDocument): Passage[] {
  const sections = document.text?.trim() ? splitSections(document.text) : [];
  const list = sections.length ? sections : [{ path: [], text: "" }];
  return list.map((section, n) => ({ key: `${source}:${document.id}#${n}`, source, document, path: section.path, text: section.text }));
}

/**
 * The fields a passage is scored on, with their weights and length normalization (BM25F). The
 * document's fields (title, path, keywords, summary) are scored apart from the passage's (headings,
 * text, code), and the two scores add up: a passage on a topic, in a document about it, beats a
 * passing mention. Code samples count little, since their identifiers ("article", "author") match
 * questions they don't answer.
 */
const FIELDS = [
  { name: "title", weight: 3, b: 0, document: true },
  { name: "path", weight: 2, b: 0, document: true },
  { name: "keywords", weight: 2, b: 0, document: true },
  { name: "summary", weight: 1.5, b: 0.5, document: true },
  { name: "heading", weight: 2, b: 0.3, document: false },
  { name: "body", weight: 1, b: 0.75, document: false },
  { name: "code", weight: 0.3, b: 0.75, document: false },
] as const;
const DOCUMENT_FIELDS = FIELDS.filter((field) => field.document).length;
const FENCED = /^\s*(```|~~~)[^\n]*\n[\s\S]*?^\s*\1\s*$/gm;
const K1 = 1.2;
const SYNONYM_WEIGHT = 0.8;
/** Reciprocal rank fusion's constant: how much the top ranks of keyword and semantic search outweigh the rest. */
const RRF_K = 60;

interface Entry {
  passage: Passage;
  fields: Map<string, number>[];
  lengths: number[];
  boost: number;
}

export interface Hit {
  passage: Passage;
  score: number;
}

export interface SearchOptions {
  limit?: number;
  /** Only passages these accept. */
  filter?(passage: Passage): boolean;
  /** At most this many passages per document. Default 2. */
  perDocument?: number;
  /** Semantic search's ranking: passage keys, the closest first. Merged with keyword search's by rank. */
  semantic?: string[];
}

export interface IndexOptions {
  /** Words people use for things the knowledge names differently, by stem. */
  synonyms?: Map<string, string[]>;
  stopwords?: ReadonlySet<string>;
  boost?(passage: Passage): number;
}

/** Keyword search over passages: stemmed terms scored with BM25F, synonyms counted at a little less weight. */
export class KnowledgeIndex {
  readonly passages: Passage[];
  private readonly entries: Entry[];
  private readonly df = new Map<string, number>();
  private readonly averages: number[];
  private readonly synonyms: Map<string, string[]>;
  private readonly stopwords: ReadonlySet<string>;

  constructor(passages: Passage[], options: IndexOptions = {}) {
    this.passages = passages;
    this.synonyms = options.synonyms ?? new Map();
    this.stopwords = options.stopwords ?? STOPWORDS;
    const counted = new Set<KnowledgeDocument>();
    this.entries = passages.map((passage) => {
      const { document } = passage;
      const code = passage.text.match(FENCED) ?? [];
      const texts = [
        document.title,
        document.id.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[/_.:#]+/g, " "),
        document.keywords?.join(" ") ?? "",
        document.summary ?? "",
        passage.path.join(" "),
        code.length ? passage.text.replace(FENCED, "\n") : passage.text,
        code.join("\n"),
      ];
      const fields = texts.map((text) => {
        const counts = new Map<string, number>();
        for (const term of tokenize(text, this.stopwords)) counts.set(term, (counts.get(term) ?? 0) + 1);
        return counts;
      });
      // Rarity counts a document's own fields once, not once for each of its passages.
      const seen = new Set<string>();
      fields.forEach((counts, i) => {
        if (i < DOCUMENT_FIELDS && counted.has(document)) return;
        for (const term of counts.keys()) seen.add(term);
      });
      counted.add(document);
      for (const term of seen) this.df.set(term, (this.df.get(term) ?? 0) + 1);
      const lengths = fields.map((counts) => [...counts.values()].reduce((sum, n) => sum + n, 0));
      return { passage, fields, lengths, boost: options.boost?.(passage) ?? 1 };
    });
    this.averages = FIELDS.map((_, i) => this.entries.reduce((sum, entry) => sum + entry.lengths[i]!, 0) / Math.max(1, this.entries.length) || 1);
  }

  /** The query's concepts: each word, with its synonyms as alternatives. */
  concepts(query: string): { term: string; weight: number }[][] {
    return [...new Set(tokenize(query, this.stopwords))].map((term) => [
      { term, weight: 1 },
      ...(this.synonyms.get(term) ?? []).map((synonym) => ({ term: synonym, weight: SYNONYM_WEIGHT })),
    ]);
  }

  /** Every term that counts for the query, synonyms included: for picking snippets. */
  queryTerms(query: string): Set<string> {
    return new Set(this.concepts(query).flatMap((concept) => concept.map(({ term }) => term)));
  }

  private idf(term: string): number {
    const df = this.df.get(term) ?? 0;
    return Math.log(1 + (this.entries.length - df + 0.5) / (df + 0.5));
  }

  private score(entry: Entry, concepts: { term: string; weight: number }[][]): number {
    let score = 0;
    let matched = 0;
    for (const concept of concepts) {
      let best = 0;
      for (const { term, weight } of concept) {
        const tf = [0, 0];
        FIELDS.forEach((field, i) => {
          const count = entry.fields[i]!.get(term);
          if (count) tf[field.document ? 0 : 1]! += (field.weight * count) / (1 - field.b + (field.b * entry.lengths[i]!) / this.averages[i]!);
        });
        const saturated = tf.reduce((sum, value) => sum + (value * (K1 + 1)) / (K1 + value), 0);
        if (saturated) best = Math.max(best, weight * this.idf(term) * saturated);
      }
      if (best > 0) matched++;
      score += best;
    }
    // Passages that cover more of the question rank higher.
    return score * (0.5 + (0.5 * matched) / concepts.length) * entry.boost;
  }

  search(query: string, options: SearchOptions = {}): Hit[] {
    const { limit = 6, perDocument = 2 } = options;
    const concepts = this.concepts(query);
    const candidates = options.filter ? this.entries.filter((entry) => options.filter!(entry.passage)) : this.entries;
    let ranked: Hit[] = concepts.length
      ? candidates
          .map((entry) => ({ passage: entry.passage, score: this.score(entry, concepts) }))
          .filter((hit) => hit.score > 0)
          .sort((a, b) => b.score - a.score)
      : [];
    if (options.semantic?.length) {
      const allowed = new Map(candidates.map((entry) => [entry.passage.key, entry.passage]));
      const fused = new Map<string, Hit>();
      const add = (passage: Passage, rank: number) => {
        const hit = fused.get(passage.key) ?? { passage, score: 0 };
        hit.score += 1 / (RRF_K + rank);
        fused.set(passage.key, hit);
      };
      ranked.slice(0, 50).forEach((hit, rank) => add(hit.passage, rank));
      options.semantic.filter((key) => allowed.has(key)).slice(0, 50).forEach((key, rank) => add(allowed.get(key)!, rank));
      ranked = [...fused.values()].sort((a, b) => b.score - a.score);
    }
    const perDoc = new Map<string, number>();
    // Passages that say the same thing (tickets answered with the same reply) are one result.
    const seen = new Set<string>();
    const out: Hit[] = [];
    for (const hit of ranked) {
      const doc = `${hit.passage.source}:${hit.passage.document.id}`;
      const count = perDoc.get(doc) ?? 0;
      const same = `${hit.passage.document.title}\n${hit.passage.text}`;
      if (count >= perDocument || seen.has(same)) continue;
      perDoc.set(doc, count + 1);
      seen.add(same);
      out.push(hit);
      if (out.length >= limit) break;
    }
    return out;
  }
}
