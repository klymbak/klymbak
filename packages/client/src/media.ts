import type { MediaItem } from "@klymbak/protocol";

/**
 * Returns the URL when it is http(s) or a path, else undefined. Tool results are data, so a
 * `javascript:` URL in one must never reach an href. The browser's own parser decides, which
 * also catches tricks like "java\tscript:".
 */
export function safeUrl(url: unknown): string | undefined {
  if (typeof url !== "string" || !url) return undefined;
  try {
    const { protocol } = new URL(url, globalThis.location?.href ?? "http://localhost/");
    return protocol === "http:" || protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** The file's name, else the last segment of its URL. */
export function mediaName(item: MediaItem): string {
  if (item.name) return item.name;
  const segment = item.url.split(/[?#]/)[0]!.split("/").filter(Boolean).pop() ?? item.url;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Short file type for labels, "PNG" or "PDF": from the name or URL's extension, else the MIME type. */
export function mediaType(item: MediaItem): string | undefined {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(mediaName(item))?.[1] ?? /\.([a-z0-9]{1,5})(?:[?#]|$)/i.exec(item.url)?.[1];
  const subtype = item.mime?.split("/")[1]?.split(/[+;]/)[0];
  return (extension ?? (subtype && subtype.length <= 5 ? subtype : undefined))?.toUpperCase();
}

/** "PNG · 1024×1024": the file type and, when known, the dimensions. */
export function mediaMeta(item: MediaItem): string {
  const size = item.width && item.height ? `${item.width}×${item.height}` : undefined;
  return [mediaType(item), size].filter(Boolean).join(" · ");
}
