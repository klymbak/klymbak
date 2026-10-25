/** Markdown documents as sections, and HTML pages as Markdown. */

export interface Heading {
  level: number;
  text: string;
  /** Offset of the heading line. */
  start: number;
}

/** The document's headings, outside code fences. */
export function headings(markdown: string): Heading[] {
  const found: Heading[] = [];
  let fenced = false;
  let offset = 0;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) found.push({ level: match[1]!.length, text: match[2]!.trim(), start: offset });
    offset += line.length + 1;
  }
  return found;
}

export interface Section {
  /** The headings above it, outermost first, without the document's title. Empty for the intro. */
  path: string[];
  /** The section's Markdown, its heading included. */
  text: string;
}

/** Sections longer than this are indexed in parts, so a long one doesn't drown the passage that matters. */
const PART_LENGTH = 1_800;

/**
 * Splits a document at its headings of level 1 to 3; deeper ones stay in their section. A first
 * level-1 heading is the document's title, not a section.
 */
export function splitSections(markdown: string): Section[] {
  const all = headings(markdown).filter((heading) => heading.level <= 3);
  const title = all[0]?.level === 1 && !markdown.slice(0, all[0].start).trim() ? all[0] : undefined;
  const cuts = all.filter((heading) => heading !== title);
  const sections: Section[] = [];
  const stack: Heading[] = [];
  const push = (path: string[], text: string) => {
    for (const part of parts(text.trim())) if (part) sections.push({ path, text: part });
  };
  let start = 0;
  if (title) {
    const end = markdown.indexOf("\n", title.start);
    start = end < 0 ? markdown.length : end + 1;
  }
  let path: string[] = [];
  for (const heading of cuts) {
    push(path, markdown.slice(start, heading.start));
    while (stack.length && stack[stack.length - 1]!.level >= heading.level) stack.pop();
    stack.push(heading);
    path = stack.map((h) => h.text);
    start = heading.start;
  }
  push(path, markdown.slice(start));
  return sections;
}

/** A long section in parts of about PART_LENGTH characters, cut between paragraphs. */
function parts(text: string): string[] {
  if (text.length <= PART_LENGTH * 1.5) return [text];
  const out: string[] = [];
  let current = "";
  for (const paragraph of text.split(/\n{2,}/)) {
    if (current && current.length + paragraph.length > PART_LENGTH) {
      out.push(current);
      current = "";
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
    while (current.length > PART_LENGTH * 2) {
      const cut = current.lastIndexOf(" ", PART_LENGTH) > 0 ? current.lastIndexOf(" ", PART_LENGTH) : PART_LENGTH;
      out.push(current.slice(0, cut));
      current = current.slice(cut).trimStart();
    }
  }
  if (current) out.push(current);
  return out;
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function outline(markdown: string): string {
  return headings(markdown)
    .filter((heading) => heading.level === 2 || heading.level === 3)
    .map((heading) => `${heading.level === 3 ? "  " : ""}- ${heading.text}`)
    .join("\n");
}

/** Longer documents return their outline first, then one section at a time. */
const DOCUMENT_LIMIT = 20_000;
const INTRO_LIMIT = 4_000;

/**
 * What the model reads of a document: all of it when it is short; otherwise the intro and the
 * outline, or the one section asked for (with its subsections). `again` says how to read a section.
 */
export function excerpt(markdown: string, section: string | undefined, again: string): string {
  const all = headings(markdown);
  if (section) {
    const wanted = normalize(section.split("›").pop()!);
    const heading = all.find((h) => normalize(h.text) === wanted) ?? all.find((h) => wanted && normalize(h.text).includes(wanted));
    if (!heading) return `This document has no section "${section}". Its sections:\n${outline(markdown) || "(none)"}`;
    const end = all.find((h) => h.start > heading.start && h.level <= heading.level)?.start ?? markdown.length;
    return cut(markdown.slice(heading.start, end).trim(), DOCUMENT_LIMIT);
  }
  if (markdown.length <= DOCUMENT_LIMIT) return markdown;
  const firstSection = all.find((h) => h.level === 2)?.start ?? INTRO_LIMIT;
  return [
    cut(markdown.slice(0, firstSection).trim(), INTRO_LIMIT),
    `This document is long, so read it one section at a time: ${again} with \`section\` set to one of these headings.\n${outline(markdown)}`,
  ].join("\n\n");
}

function cut(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}\n\n[…cut. Ask for a narrower section to read the rest.]`;
}

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", copy: "©", reg: "®", trade: "™", deg: "°", euro: "€", pound: "£", middot: "·", times: "×" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** The page's title: its <title>, else its first <h1>. */
export function htmlTitle(html: string): string | undefined {
  const raw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const title = raw && decodeEntities(raw.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  return title || undefined;
}

/**
 * An HTML page or fragment as Markdown: its main content (<main> or <article> when it has one)
 * without scripts, navigation, headers and footers; headings, paragraphs, lists, links, emphasis,
 * code and tables kept. Relative links resolve against `base`.
 */
export function htmlToMarkdown(html: string, base?: string): string {
  let body = /<main\b[^>]*>([\s\S]*)<\/main>/i.exec(html)?.[1] ?? /<article\b[^>]*>([\s\S]*)<\/article>/i.exec(html)?.[1] ?? /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  body = body
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|nav|header|footer|aside|form|button|iframe|head)\b[\s\S]*?<\/\1>/gi, "");
  const link = (href: string) => {
    if (!base || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(href)) return href;
    try {
      return new URL(href, base).href;
    } catch {
      return href;
    }
  };
  // Entities are decoded once, at the end, so "&amp;lt;" stays "&lt;".
  const inline = (text: string) => text.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const markdown = body
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, code: string) => `\n\n\`\`\`\n${code.replace(/<[^>]+>/g, "").trim()}\n\`\`\`\n\n`)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, text: string) => `\n\n${"#".repeat(Number(level))} ${inline(text)}\n\n`)
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
      const label = inline(text);
      return label ? `[${label}](${link(decodeEntities(href)).replace(/&/g, "&amp;")})` : "";
    })
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, text: string) => (inline(text) ? `**${inline(text)}**` : ""))
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, text: string) => (inline(text) ? `*${inline(text)}*` : ""))
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_m, text: string) => `\`${inline(text)}\``)
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/t[hd]>\s*<t[hd]\b[^>]*>/gi, " | ")
    .replace(/<tr\b[^>]*>/gi, "\n| ")
    .replace(/<\/tr>/gi, " |")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|ul|ol|table|thead|tbody|blockquote|dl|dt|dd|figure|figcaption|hr)\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(markdown)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
