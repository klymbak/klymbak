/**
 * Words for keyword search: lowercased, accents dropped, stemmed, common words left out. Built for
 * English, the language most knowledge bases here are written in; other Latin-script text still
 * matches word for word, and Chinese, Japanese and Korean text matches by pairs of characters.
 */

/** Common words, plus the verbs of requests ("add a new…", "give…"), which match the wrong passages. */
export const STOPWORDS: ReadonlySet<string> = new Set(
  `a about add adding all also an and any are as at be by can could create do does for from get give has have help how i if in
  into is it its let like make me my need new no not of on or our please set should so some than that the their them then there
  these this to us use using want was way we what when where which who why will with would you your`.split(/\s+/),
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

/** "Crème brûlée" → "creme brulee": lowercase, without accents, so either spelling finds the other. */
export function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
}

const WORD = /[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu;
/** Scripts written without spaces between words. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * The search terms in a text, in order and with repeats (for term frequency): stems, hyphenated
 * words whole ("content-type-builder") and in parts, pairs of characters for Chinese, Japanese and
 * Korean. `stopwords` are left out.
 */
export function tokenize(text: string, stopwords: ReadonlySet<string> = STOPWORDS): string[] {
  const out: string[] = [];
  const add = (word: string) => {
    if (word && !stopwords.has(word)) out.push(stem(word));
  };
  for (const word of fold(text).match(WORD) ?? []) {
    if (UNSPACED.test(word)) {
      if (word.length === 1) out.push(word);
      for (let i = 0; i + 1 < word.length; i++) out.push(word.slice(i, i + 2));
    } else if (word.includes("-")) {
      out.push(word);
      word.split("-").forEach(add);
    } else add(word);
  }
  return out;
}

/** The distinct terms of a text. */
export function terms(text: string, stopwords?: ReadonlySet<string>): string[] {
  return [...new Set(tokenize(text, stopwords))];
}

/** Words as single terms: stemmed, hyphenated ones whole ("media-library"). */
function wordTerms(text: string): string[] {
  return (fold(text).match(WORD) ?? []).map((word) => (word.includes("-") ? word : stem(word)));
}

/** Synonyms by stem, both sides stemmed as passages are: { translate: ["i18n"] } finds "translations" too. */
export function synonymMap(words: Record<string, string[]> | undefined): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [word, synonyms] of Object.entries(words ?? {})) {
    for (const key of wordTerms(word)) {
      const found = synonyms.flatMap(wordTerms).filter((term) => term !== key);
      map.set(key, [...new Set([...(map.get(key) ?? []), ...found])]);
    }
  }
  return map;
}

/** Markdown down to the words people read, for snippets and excerpts. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/gm, "")
    .replace(/(\*\*|__|`)/g, "")
    // Table rows stay one per line, without their outer pipes.
    .replace(/^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$/gm, "")
    .replace(/[ \t]*\|[ \t]*/g, " | ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * The part of a passage that best matches the query: the sentence or line with the most of its
 * terms, with what follows it up to `length` characters. Line breaks are kept.
 */
export function snippet(text: string, queryTerms: ReadonlySet<string>, length = 280): string {
  const plain = plainText(text);
  if (plain.length <= length) return plain;
  const pieces: { text: string; newLine: boolean }[] = [];
  for (const line of plain.split("\n")) {
    line
      .split(/(?<=[.!?])\s+/)
      .filter((piece) => piece.trim())
      .forEach((piece, i) => pieces.push({ text: piece.trim(), newLine: i === 0 && pieces.length > 0 }));
  }
  let best = 0;
  let bestScore = -1;
  pieces.forEach((piece, i) => {
    const score = new Set(tokenize(piece.text).filter((term) => queryTerms.has(term))).size;
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  if (bestScore <= 0) best = 0;
  let out = pieces[best]!.text;
  for (let i = best + 1; i < pieces.length && out.length < length; i++) out += `${pieces[i]!.newLine ? "\n" : " "}${pieces[i]!.text}`;
  if (out.length > length) out = `${out.slice(0, length).replace(/\s+\S*$/, "")}…`;
  return best > 0 ? `…${out}` : out;
}
