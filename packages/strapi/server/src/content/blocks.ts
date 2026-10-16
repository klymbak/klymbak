/**
 * Strapi's Blocks rich-text format, converted to and from Markdown so the model can read and
 * write it as text. Covers what the Blocks editor produces: paragraphs, headings, lists, quotes,
 * code, images and links, with bold, italic, underline, strikethrough and inline code.
 *
 * Image blocks point at uploaded media, so Markdown images become links on the way in.
 */

export interface TextNode {
  type: "text";
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
}

export interface LinkNode {
  type: "link";
  url: string;
  children: TextNode[];
}

type Inline = TextNode | LinkNode;

/** A nested list sits next to the items of its parent list, not inside one. */
interface ListBlock {
  type: "list";
  format: "ordered" | "unordered";
  children: (ListItem | ListBlock)[];
}

interface ListItem {
  type: "list-item";
  children: Inline[];
}

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: "quote"; children: Inline[] }
  | { type: "code"; language?: string; children: TextNode[] }
  | ListBlock
  | { type: "image"; image: { url: string; alternativeText?: string | null; [key: string]: unknown }; children: TextNode[] };

export function isBlocks(value: unknown): value is Block[] {
  return Array.isArray(value) && value.every((node) => node && typeof node === "object" && typeof (node as Block).type === "string");
}

// ---------------------------------------------------------------------------
// Blocks → Markdown
// ---------------------------------------------------------------------------

function textToMarkdown(node: TextNode): string {
  if (!node.text) return "";
  if (node.code) return `\`${node.text}\``;
  const trimmed = node.text.trim();
  if (!trimmed) return node.text;
  const lead = node.text.slice(0, node.text.indexOf(trimmed));
  const trail = node.text.slice(lead.length + trimmed.length);
  let text = trimmed;
  if (node.bold) text = `**${text}**`;
  if (node.italic) text = `*${text}*`;
  if (node.strikethrough) text = `~~${text}~~`;
  if (node.underline) text = `<u>${text}</u>`;
  return lead + text + trail;
}

function inlineToMarkdown(children: Inline[] = []): string {
  return children
    .map((child) => (child.type === "link" ? `[${inlineToMarkdown(child.children)}](${child.url})` : textToMarkdown(child)))
    .join("");
}

function listToMarkdown(list: ListBlock, depth: number): string {
  let number = 0;
  return list.children
    .map((child) => {
      if (child.type === "list") return listToMarkdown(child, depth + 1);
      const marker = list.format === "ordered" ? `${++number}.` : "-";
      return `${"  ".repeat(depth)}${marker} ${inlineToMarkdown(child.children)}`;
    })
    .join("\n");
}

export function blocksToMarkdown(blocks: Block[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case "heading":
          return `${"#".repeat(block.level)} ${inlineToMarkdown(block.children)}`;
        case "quote":
          return inlineToMarkdown(block.children)
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        case "code":
          return `\`\`\`${block.language ?? ""}\n${block.children.map((child) => child.text).join("")}\n\`\`\``;
        case "list":
          return listToMarkdown(block, 0);
        case "image":
          return `![${block.image?.alternativeText ?? ""}](${block.image?.url ?? ""})`;
        default:
          return inlineToMarkdown((block as { children?: Inline[] }).children);
      }
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Markdown → Blocks
// ---------------------------------------------------------------------------

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|~~([^~]+)~~|`([^`]+)`|<u>(.+?)<\/u>|\[([^\]]+)\]\(([^)\s]+)\))/;

function parseInline(text: string, marks: Omit<TextNode, "type" | "text"> = {}): Inline[] {
  const nodes: Inline[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE.exec(rest);
    if (!match) {
      nodes.push({ type: "text", text: rest, ...marks });
      break;
    }
    if (match.index > 0) nodes.push({ type: "text", text: rest.slice(0, match.index), ...marks });
    const [, , bold1, bold2, italic1, italic2, strike, code, underline, linkText, url] = match;
    if (bold1 ?? bold2) nodes.push(...parseInline((bold1 ?? bold2)!, { ...marks, bold: true }));
    else if (italic1 ?? italic2) nodes.push(...parseInline((italic1 ?? italic2)!, { ...marks, italic: true }));
    else if (strike) nodes.push(...parseInline(strike, { ...marks, strikethrough: true }));
    else if (code) nodes.push({ type: "text", text: code, ...marks, code: true });
    else if (underline) nodes.push(...parseInline(underline, { ...marks, underline: true }));
    else if (linkText && url) nodes.push({ type: "link", url, children: textOnly(parseInline(linkText, marks)) });
    rest = rest.slice(match.index + match[0].length);
  }
  return nodes.length ? nodes : [{ type: "text", text: "" }];
}

/** Links hold text nodes only; a link written inside link text keeps just its words. */
function textOnly(nodes: Inline[]): TextNode[] {
  return nodes.flatMap((node) => (node.type === "text" ? [node] : node.children));
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const IMAGE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const BLOCK_START = /^(#{1,6}\s|>|```)/;

export function markdownToBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = line.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) body.push(lines[i++]!);
      i++;
      blocks.push({ type: "code", ...(fence[1] ? { language: fence[1] } : {}), children: [{ type: "text", text: body.join("\n") }] });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length as 1, children: parseInline(heading[2]!.trim()) });
      i++;
      continue;
    }

    const image = line.trim().match(IMAGE);
    if (image) {
      blocks.push({ type: "paragraph", children: [{ type: "link", url: image[2]!, children: [{ type: "text", text: image[1] || image[2]! }] }] });
      i++;
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) quote.push(lines[i++]!.replace(/^>\s?/, ""));
      blocks.push({ type: "quote", children: parseInline(quote.join("\n")) });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const items: { indent: number; ordered: boolean; text: string }[] = [];
      while (i < lines.length && LIST_ITEM.test(lines[i]!)) {
        const [, indent, marker, text] = lines[i++]!.match(LIST_ITEM)!;
        items.push({ indent: indent!.replace(/\t/g, "  ").length, ordered: /\d/.test(marker!), text: text! });
      }
      blocks.push(buildList(items, 0, items.length, items[0]!.indent));
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !BLOCK_START.test(lines[i]!) && !LIST_ITEM.test(lines[i]!)) paragraph.push(lines[i++]!.trim());
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n")) });
  }

  return blocks.length ? blocks : [{ type: "paragraph", children: [{ type: "text", text: "" }] }];
}

function buildList(items: { indent: number; ordered: boolean; text: string }[], start: number, end: number, indent: number): ListBlock {
  const list: ListBlock = { type: "list", format: items[start]!.ordered ? "ordered" : "unordered", children: [] };
  let i = start;
  while (i < end) {
    list.children.push({ type: "list-item", children: parseInline(items[i]!.text) });
    let j = i + 1;
    while (j < end && items[j]!.indent > indent) j++;
    if (j > i + 1) list.children.push(buildList(items, i + 1, j, items[i + 1]!.indent));
    i = j;
  }
  return list;
}
