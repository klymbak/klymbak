/**
 * Generative UI blocks.
 *
 * Tools attach UI blocks to their results. Blocks go straight to the browser and are
 * rendered as tables, charts, stat tiles, etc. The model only sees the tool's text
 * output, so a 500-row table costs the user nothing in tokens.
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export type ValueFormat =
  | "text"
  | "number"
  | "integer"
  | "currency"
  | "percent"
  | "date"
  | "datetime"
  | "relative"
  | "badge"
  | "code"
  | "email";

export interface TableColumn {
  key: string;
  label: string;
  format?: ValueFormat;
  align?: "left" | "right" | "center";
  /** ISO 4217 code used when format is "currency". Defaults to USD. */
  currency?: string;
  /** Tone per value when format is "badge", e.g. { refunded: "danger" }. */
  tones?: Record<string, Tone>;
}

export interface TableBlock {
  type: "table";
  title?: string;
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  /** Total matching rows when `rows` is a page of a larger result. */
  totalRows?: number;
  caption?: string;
  /** Column whose value identifies a row; enables row actions. */
  rowKey?: string;
  /** Actions offered for each row. `{key}` placeholders in prompts are filled from the row. */
  rowActions?: UiAction[];
}

export interface StatItem {
  label: string;
  value: string | number;
  format?: ValueFormat;
  currency?: string;
  /** Relative change, e.g. 0.12 for +12%. */
  delta?: number;
  deltaLabel?: string;
  /** When true, a negative delta is good (e.g. refunds going down). */
  invertDelta?: boolean;
  tone?: Tone;
}

export interface StatsBlock {
  type: "stats";
  title?: string;
  items: StatItem[];
}

export interface ChartSeries {
  key: string;
  label: string;
  format?: ValueFormat;
  currency?: string;
}

export interface ChartBlock {
  type: "chart";
  title?: string;
  kind: "bar" | "line" | "area";
  x: { key: string; label?: string; format?: ValueFormat };
  series: ChartSeries[];
  data: Record<string, unknown>[];
  caption?: string;
}

export interface KeyValueItem {
  label: string;
  value: unknown;
  format?: ValueFormat;
  currency?: string;
  tone?: Tone;
}

export interface KeyValueBlock {
  type: "keyvalue";
  title?: string;
  items: KeyValueItem[];
}

export interface MarkdownBlock {
  type: "markdown";
  text: string;
}

export interface AlertBlock {
  type: "alert";
  tone: Tone;
  title?: string;
  text: string;
}

export interface MediaItem {
  /** Where the file is served. A path such as `/uploads/cat.png` resolves against the page showing the chat. */
  url: string;
  name?: string;
  /** Alternative text for an image. */
  alt?: string;
  caption?: string;
  /** MIME type, which picks the preview. Without it, the URL's extension does. */
  mime?: string;
  width?: number;
  height?: number;
}

/** Files shown as a gallery: images and videos as previews, other files as a tile that opens them. */
export interface MediaBlock {
  type: "media";
  title?: string;
  items: MediaItem[];
  /** Total matching files when `items` is a page of a larger result. */
  totalItems?: number;
  caption?: string;
}

export interface SourceItem {
  /** The document's title. */
  title: string;
  /** Where people can read it. Without one, the excerpt is what they can check. */
  url?: string;
  /** Where in the document: a section, "Returns › Damaged items", or a page, "Page 3". */
  location?: string;
  /** The collection it came from, e.g. "Help center" or "Resolved tickets". */
  source?: string;
  /** The passage the answer rests on. */
  excerpt?: string;
}

/** Where an answer comes from: documents and passages people can open or read to check it. */
export interface SourcesBlock {
  type: "sources";
  title?: string;
  items: SourceItem[];
}

export type UiActionKind = "prompt" | "event" | "link";

export interface UiAction {
  label: string;
  /** prompt: send `prompt` as the next user message. event: emit to the host app. link: open `href`. */
  kind?: UiActionKind;
  prompt?: string;
  event?: string;
  payload?: unknown;
  href?: string;
  tone?: Tone;
}

export interface ActionsBlock {
  type: "actions";
  title?: string;
  actions: UiAction[];
}

/** Rendered by a component the host app registers under `component`. */
export interface CustomBlock {
  type: "custom";
  component: string;
  props?: Record<string, unknown>;
}

export type UiBlock =
  | TableBlock
  | StatsBlock
  | ChartBlock
  | KeyValueBlock
  | MarkdownBlock
  | AlertBlock
  | MediaBlock
  | SourcesBlock
  | ActionsBlock
  | CustomBlock;

/** Builders so tool authors get type checking without spelling out `type`. */
export const ui = {
  table: (block: Omit<TableBlock, "type">): TableBlock => ({ type: "table", ...block }),
  stats: (items: StatItem[], title?: string): StatsBlock => ({ type: "stats", title, items }),
  chart: (block: Omit<ChartBlock, "type">): ChartBlock => ({ type: "chart", ...block }),
  keyValue: (items: KeyValueItem[], title?: string): KeyValueBlock => ({ type: "keyvalue", title, items }),
  markdown: (text: string): MarkdownBlock => ({ type: "markdown", text }),
  alert: (tone: Tone, text: string, title?: string): AlertBlock => ({ type: "alert", tone, text, title }),
  media: (items: MediaItem[], title?: string): MediaBlock => ({ type: "media", title, items }),
  sources: (items: SourceItem[], title?: string): SourcesBlock => ({ type: "sources", title, items }),
  actions: (actions: UiAction[], title?: string): ActionsBlock => ({ type: "actions", title, actions }),
  custom: (component: string, props?: Record<string, unknown>): CustomBlock => ({ type: "custom", component, props }),
};

/**
 * Builds a table block from an array of flat objects, inferring columns.
 * Returns undefined when the value is not a non-empty array of plain objects.
 */
export function autoTable(value: unknown, title?: string): TableBlock | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!value.every((row) => row !== null && typeof row === "object" && !Array.isArray(row))) return undefined;
  const keys: string[] = [];
  for (const row of value as Record<string, unknown>[]) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) keys.push(key);
      if (keys.length >= 12) break;
    }
  }
  const columns: TableColumn[] = keys.map((key) => {
    const sample = (value as Record<string, unknown>[]).find((row) => row[key] != null)?.[key];
    return {
      key,
      label: humanize(key),
      format: typeof sample === "number" ? "number" : undefined,
      align: typeof sample === "number" ? "right" : undefined,
    };
  });
  return { type: "table", title, columns, rows: value as Record<string, unknown>[] };
}

/** How a file previews: from its MIME type, else its URL's extension. */
export function mediaKind(item: Pick<MediaItem, "url" | "mime">): "image" | "video" | "file" {
  const type = item.mime?.split("/")[0];
  if (type === "image" || type === "video") return type;
  if (item.mime) return "file";
  const path = item.url.split(/[?#]/)[0]!;
  if (/\.(avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i.test(path)) return "image";
  if (/\.(m4v|mov|mp4|ogv|webm)$/i.test(path)) return "video";
  return "file";
}

const nonEmpty = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/**
 * Builds a media block from a file record or a list of them: objects with a `url` and either a
 * MIME type (`mime`, `mimeType` or `contentType`) or an image or video extension, as in Strapi's
 * media library and most asset APIs. Returns undefined for anything else, such as a list of links.
 */
export function autoMedia(value: unknown, title?: string): MediaBlock | undefined {
  const records = Array.isArray(value) ? value : [value];
  if (records.length === 0) return undefined;
  const items: MediaItem[] = [];
  for (const record of records) {
    if (record === null || typeof record !== "object" || Array.isArray(record)) return undefined;
    const { url, mime, mimeType, contentType, name, filename, alternativeText, alt, caption, width, height } = record as Record<string, unknown>;
    if (typeof url !== "string" || !url) return undefined;
    const type = [mime, mimeType, contentType].find((v): v is string => typeof v === "string" && v.includes("/"));
    if (!type && mediaKind({ url }) === "file") return undefined;
    items.push({
      url,
      name: nonEmpty(name) ?? nonEmpty(filename),
      alt: nonEmpty(alternativeText) ?? nonEmpty(alt),
      caption: nonEmpty(caption),
      mime: type,
      width: typeof width === "number" ? width : undefined,
      height: typeof height === "number" ? height : undefined,
    });
  }
  return { type: "media", title, items };
}

export function humanize(identifier: string): string {
  const spaced = identifier
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
