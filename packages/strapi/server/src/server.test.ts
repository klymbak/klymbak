import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentServer, memoryStorage, type SessionRecord } from "@klymbak/server";
import { readSseStream, type NotificationEvent } from "@klymbak/protocol";
import { toAgentUser } from "./auth.ts";
import { validateConfig } from "./config.ts";
import { sendResponse, toRequest, type KoaContext } from "./koa.ts";
import { isReadOnlyStrapiTool, isStrapiContentTool, loopbackUrl, strapiMcpServer } from "./mcp.ts";
import { databaseStorage, type QueryEngine } from "./storage.ts";

/** A Koa-like context over a real Node request, with the body already parsed (as strapi::body does). */
function koaContext(req: IncomingMessage, res: ServerResponse, path: string, body: unknown): KoaContext & { send(): void } {
  const headers = new Map<string, string>();
  const ctx = {
    method: req.method ?? "GET",
    path,
    querystring: new URL(req.url ?? "/", "http://x").search.slice(1),
    request: { headers: req.headers, body },
    res,
    status: 404,
    body: undefined as unknown,
    set: (name: string, value: string) => headers.set(name, value),
    // What Koa's respond() does with the status, headers and body the bridge set.
    send() {
      res.statusCode = ctx.status;
      for (const [name, value] of headers) res.setHeader(name, value);
      if (ctx.body instanceof Readable) ctx.body.pipe(res);
      else res.end(ctx.body ?? undefined);
    },
  };
  return ctx;
}

const servers: { close(): void }[] = [];
afterEach(() => servers.splice(0).forEach((server) => server.close()));

describe("Koa bridge", () => {
  it("serves the agent API through a Koa-style context, streaming runs as they happen", async () => {
    const agent = createAgentServer({
      systemPrompt: "Test",
      models: { providers: [] },
      schedules: false,
      storage: memoryStorage(),
      logger: { info() {}, warn() {}, error() {} },
      auth: () => ({ id: "1", name: "Ada", roles: ["strapi-super-admin", "admin"] }),
    });
    const http = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const text = Buffer.concat(chunks).toString();
      const path = new URL(req.url!, "http://x").pathname.replace(/^\/klymbak\/agent/, "");
      const ctx = koaContext(req, res, path, text ? JSON.parse(text) : {});
      await sendResponse(ctx, await agent.fetch(toRequest(ctx, path)));
      ctx.send();
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    servers.push(http);
    const base = `http://127.0.0.1:${(http.address() as { port: number }).port}/klymbak/agent`;

    const created = await fetch(`${base}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(created.status).toBe(201);
    const session = (await created.json()) as { id: string };

    const listed = await fetch(`${base}/sessions`);
    expect(((await listed.json()) as unknown[]).length).toBe(1);

    // Event streams flow through Koa as they are written, and end when the client leaves.
    const controller = new AbortController();
    const events = await fetch(`${base}/events`, { headers: { accept: "text/event-stream" }, signal: controller.signal });
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const first = await new Promise<NotificationEvent>((resolve) => {
      void readSseStream(events.body!, (message) => resolve(JSON.parse(message.data))).catch(() => undefined);
    });
    expect(first.type).toBe("hello");
    controller.abort();

    // Without a model the run is refused with a JSON error rather than a broken stream.
    const run = await fetch(`${base}/sessions/${session.id}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ prompt: "Hi" }),
    });
    expect(run.ok).toBe(false);
    expect(((await run.json()) as { error: string }).error).toBeTruthy();

    const deleted = await fetch(`${base}/sessions/${session.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    const bad = await fetch(`${base}/sessions/nope`);
    expect(bad.status).toBe(404);
    expect(((await bad.json()) as { code: string }).code).toBeTruthy();
  });

  it("keeps the query string and serializes parsed bodies only for methods that have one", async () => {
    const res = { on() {} };
    const get = toRequest({ method: "GET", path: "/x", querystring: "a=1", request: { headers: { accept: "application/json" }, body: {} }, res, status: 0, body: undefined, set() {} }, "/schedules");
    expect(get.url).toBe("http://strapi.internal/schedules?a=1");
    expect(get.body).toBeNull();
    const patch = toRequest({ method: "PATCH", path: "/x", querystring: "", request: { headers: {}, body: { title: "New" } }, res, status: 0, body: undefined, set() {} }, "sessions/1");
    expect(patch.url).toBe("http://strapi.internal/sessions/1");
    expect(await patch.json()).toEqual({ title: "New" });
  });

  it("keeps non-204 empty responses, which Koa would otherwise turn into a 204", async () => {
    const ctx = { status: 0, body: undefined as unknown, set() {} } as unknown as KoaContext;
    await sendResponse(ctx, new Response(null, { status: 202 }));
    expect(ctx.status).toBe(202);
    expect(ctx.body).toBe("");
  });
});

/** An in-memory stand-in for Strapi's Query Engine, with the operators the storage uses. */
function fakeDb() {
  const tables = new Map<string, Record<string, any>[]>();
  let id = 0;
  const matches = (row: Record<string, any>, where: Record<string, any> = {}): boolean =>
    Object.entries(where).every(([key, condition]) => {
      if (key === "$or") return (condition as Record<string, any>[]).some((c) => matches(row, c));
      if (condition && typeof condition === "object" && "$notNull" in condition) return (row[key] != null) === condition.$notNull;
      return row[key] === condition;
    });
  return {
    query(uid: string): QueryEngine {
      const rows = tables.get(uid) ?? tables.set(uid, []).get(uid)!;
      return {
        findOne: async ({ where }) => structuredClone(rows.find((row) => matches(row, where)) ?? null),
        findMany: async ({ where } = {}) => structuredClone(rows.filter((row) => matches(row, where))),
        create: async ({ data }) => rows.push({ id: ++id, ...structuredClone(data) }),
        update: async ({ where, data }) => Object.assign(rows.find((row) => matches(row, where))!, structuredClone(data)),
        delete: async ({ where }) => rows.splice(rows.findIndex((row) => matches(row, where)), 1),
      };
    },
  };
}

const record = (id: string, userId: string, updatedAt: number, audience?: string[]): SessionRecord => ({
  id,
  userId,
  audience,
  title: id,
  createdAt: 1,
  updatedAt,
  source: audience ? "schedule" : "chat",
  allowedTools: [],
  messages: [{ role: "user", content: id, timestamp: 1 }],
  view: [],
});

describe("database storage", () => {
  it("lists own and shared conversations, newest first, without loading transcripts", async () => {
    const storage = databaseStorage({ db: fakeDb() });
    await storage.saveSession(record("a", "1", 10));
    await storage.saveSession(record("b", "2", 20));
    await storage.saveSession(record("report", "9", 30, ["admin"]));
    await storage.saveSession({ ...record("a", "1", 40), title: "Renamed" });

    expect((await storage.listSessions({ userId: "1", roles: ["strapi-editor"] })).map((s) => [s.id, s.title])).toEqual([["a", "Renamed"]]);
    expect((await storage.listSessions({ userId: "1", roles: ["admin"] })).map((s) => s.id)).toEqual(["a", "report"]);
    expect((await storage.listSessions({ userId: "1", roles: [] }))[0]).not.toHaveProperty("messages");
    expect((await storage.getSession("a"))?.messages).toEqual([{ role: "user", content: "a", timestamp: 1 }]);

    await storage.deleteSession("a");
    expect(await storage.getSession("a")).toBeUndefined();
  });

  it("stores schedules by id", async () => {
    const storage = databaseStorage({ db: fakeDb() });
    const schedule = { id: "s1", name: "Weekly", prompt: "Report", cron: "0 9 * * 1", enabled: true, source: "user" as const, createdAt: 1 };
    await storage.saveSchedule(schedule);
    await storage.saveSchedule({ ...schedule, enabled: false });
    expect(await storage.listSchedules()).toEqual([{ ...schedule, enabled: false }]);
    await storage.deleteSchedule("s1");
    expect(await storage.listSchedules()).toEqual([]);
  });
});

describe("Strapi MCP", () => {
  it("asks before anything that isn't a read, including tools added later", () => {
    for (const name of ["list_article", "get_global", "media_list_assets", "media_get_asset", "log"]) expect(isReadOnlyStrapiTool(name)).toBe(true);
    for (const name of ["create_article", "update_article", "write_global", "delete_article", "publish_article", "unpublish_article", "discard_article_draft", "media_delete_assets", "media_move_folder", "seo_audit"]) {
      expect(isReadOnlyStrapiTool(name)).toBe(false);
    }
    const config = strapiMcpServer({ token: "t" }, { host: "0.0.0.0", port: 1337 }, { contentTools: false });
    expect(config).toMatchObject({ url: "http://127.0.0.1:1337/mcp", prefix: "strapi", headers: { authorization: "Bearer t" } });
    expect(typeof config.approval === "function" && config.approval("publish_article")).toBe(true);
    expect(config.exclude).toBeUndefined();
  });

  it("leaves out the per-content-type tools the content tools already cover, unless asked", () => {
    for (const name of ["list_article", "get_global", "create_article", "write_global", "discard_article_draft"]) expect(isStrapiContentTool(name)).toBe(true);
    for (const name of ["media_list_assets", "media_delete_assets", "log", "seo_audit"]) expect(isStrapiContentTool(name)).toBe(false);
    expect(strapiMcpServer({ token: "t" }, {}, { contentTools: true }).exclude).toBe(isStrapiContentTool);
    expect(strapiMcpServer({ token: "t", contentTools: true }, {}, { contentTools: true }).exclude).toBeUndefined();
  });

  it("reaches the server over loopback whatever it listens on", () => {
    expect(loopbackUrl({ host: "::", port: 8080 })).toBe("http://127.0.0.1:8080/mcp");
    expect(loopbackUrl({ host: "::1", port: 1337 })).toBe("http://[::1]:1337/mcp");
    expect(loopbackUrl({ host: "cms.internal" })).toBe("http://cms.internal:1337/mcp");
  });
});

describe("config and identity", () => {
  it("explains config mistakes", () => {
    expect(() => validateConfig({ contentTools: true })).not.toThrow();
    expect(() => validateConfig({ mcp: { token: "" } })).toThrow(/admin token/);
    expect(() => validateConfig({ tools: [] } as never)).toThrow(/belongs in `extend`/);
    expect(() => validateConfig({ storage: "redis" } as never)).toThrow(/storage/);
    expect(() => validateConfig({ skills: ["skills"] } as never)).toThrow(/`skills` must be a string/);
  });

  it("maps a Strapi admin to the agent's user, with super admins as Klymbak admins", () => {
    expect(toAgentUser({ id: 4, firstname: "Ada", lastname: "Lovelace", email: "ada@example.com", roles: [{ code: "strapi-super-admin" }] })).toEqual({
      id: "4",
      name: "Ada Lovelace",
      roles: ["strapi-super-admin", "admin"],
      email: "ada@example.com",
    });
    expect(toAgentUser({ id: 5, email: "e@example.com", roles: [{ code: "strapi-editor" }] }).roles).toEqual(["strapi-editor"]);
  });
});
