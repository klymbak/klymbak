import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

/** The parts of Koa's context the bridge uses. */
export interface KoaContext {
  method: string;
  path: string;
  querystring: string;
  params?: Record<string, string>;
  request: { headers: Record<string, string | string[] | undefined>; body?: unknown };
  res: { on(event: "close", listener: () => void): unknown };
  status: number;
  body: unknown;
  set(field: string, value: string): void;
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);
const FORWARDED_HEADERS = ["accept", "accept-language", "content-type", "user-agent"];
/** Hop-by-hop headers and ones Koa computes for the body it sends. */
const SKIPPED_RESPONSE_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding", "content-length"]);

/**
 * Turns a Koa request into a web Request for the agent's fetch handler.
 *
 * Strapi's `strapi::body` middleware has already read and parsed the body, so it is serialized
 * again rather than streamed. `path` is the part after the mount point, e.g. "/sessions/abc/runs".
 * The request is aborted when the client goes away, which ends any event stream it opened.
 */
export function toRequest(ctx: KoaContext, path: string): Request {
  const url = new URL(`http://strapi.internal${path.startsWith("/") ? path : `/${path}`}`);
  if (ctx.querystring) url.search = ctx.querystring;

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = ctx.request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }

  const method = ctx.method.toUpperCase();
  let body: string | undefined;
  if (BODY_METHODS.has(method)) {
    const parsed = ctx.request.body;
    body = typeof parsed === "string" ? parsed : JSON.stringify(parsed ?? {});
    headers.set("content-type", "application/json");
  }

  const controller = new AbortController();
  ctx.res.on("close", () => controller.abort());
  return new Request(url, { method, headers, body, signal: controller.signal });
}

/** Writes a web Response to Koa, streaming event streams as they are produced. */
export async function sendResponse(ctx: KoaContext, response: Response): Promise<void> {
  ctx.status = response.status;
  response.headers.forEach((value, name) => {
    if (!SKIPPED_RESPONSE_HEADERS.has(name)) ctx.set(name, value);
  });
  if (!response.body || response.status === 204 || response.status === 304) {
    // Koa turns a null body into a 204, so keep other statuses (202 Accepted) with an empty one.
    ctx.body = response.status === 204 || response.status === 304 ? null : "";
    return;
  }
  if (response.headers.get("content-type")?.startsWith("text/event-stream")) {
    ctx.body = Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>);
    return;
  }
  ctx.body = Buffer.from(await response.arrayBuffer());
}
