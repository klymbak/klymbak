import { getRequestListener } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type {
  AddMcpServerRequest,
  AgentEvent,
  ApprovalDecision,
  CreateScheduleRequest,
  CreateSessionRequest,
  NotificationEvent,
  RunRequest,
  UpdateScheduleRequest,
  UpdateSessionRequest,
} from "@klymbak/protocol";
import { AgentError } from "./errors.ts";
import { AgentRuntime } from "./runtime.ts";
import type { AgentRuntimeConfig, AgentUser, Awaitable } from "./types.ts";

export interface AgentHttpOptions {
  /**
   * Resolves the caller from the incoming request (session cookie, JWT, API key...).
   * Return null to reject with 401. Without it, every caller is a local admin, which is
   * only appropriate for development.
   */
  auth?: (request: Request) => Awaitable<AgentUser | null | undefined>;
  /** Enable CORS for browser apps served from another origin. */
  cors?: boolean | { origin: string | string[] };
}

export const LOCAL_USER: AgentUser = { id: "local", name: "Local user", roles: ["admin"] };

const KEEPALIVE_MS = 15_000;

type Env = { Variables: { user: AgentUser } };

/** HTTP + SSE API for a runtime. Mount it under any prefix, e.g. app.route("/api/agent", routes). */
export function createAgentRoutes(runtime: AgentRuntime, options: AgentHttpOptions = {}): Hono<Env> {
  const app = new Hono<Env>();

  app.onError((error, c) => {
    if (error instanceof AgentError) return c.json({ error: error.message, code: error.code }, error.status as 400);
    if (error instanceof SyntaxError) return c.json({ error: "The request body is not valid JSON.", code: "bad_json" }, 400);
    runtime.logger.error("Unhandled API error", error instanceof Error ? error.stack : String(error));
    return c.json({ error: "Something went wrong on the server.", code: "internal" }, 500);
  });

  if (options.cors) {
    const origin = options.cors === true ? "*" : options.cors.origin;
    app.use("*", cors({ origin, allowHeaders: ["content-type", "authorization", "x-requested-with"], credentials: origin !== "*" }));
  }

  app.get("/health", (c) => c.json({ ok: true }));

  app.use("*", async (c, next) => {
    await runtime.start();
    const user = options.auth ? await options.auth(c.req.raw) : LOCAL_USER;
    if (!user) return c.json({ error: "Sign in to use the assistant.", code: "unauthorized" }, 401);
    c.set("user", user);
    await next();
  });

  app.get("/config", async (c) => c.json(await runtime.configInfo(c.get("user"))));

  // Sessions ------------------------------------------------------------------
  app.get("/sessions", async (c) => c.json(await runtime.listSessions(c.get("user"))));
  app.post("/sessions", async (c) => c.json(await runtime.createSession(c.get("user"), await body<CreateSessionRequest>(c, {})), 201));
  app.get("/sessions/:id", async (c) => c.json(await runtime.getSession(c.get("user"), c.req.param("id"))));
  app.patch("/sessions/:id", async (c) =>
    c.json(await runtime.updateSession(c.get("user"), c.req.param("id"), await body<UpdateSessionRequest>(c))),
  );
  app.delete("/sessions/:id", async (c) => {
    await runtime.deleteSession(c.get("user"), c.req.param("id"));
    return c.body(null, 204);
  });

  /** Starts a run and streams its events until run_end. */
  app.post("/sessions/:id/runs", async (c) => {
    const channel = new Channel<AgentEvent>();
    const run = await runtime.startRun(c.get("user"), c.req.param("id"), await body<RunRequest>(c), (event) => channel.push(event));
    return pipe(c, channel, (event) => event.type === "run_end", run.detach);
  });

  /** Follows a session: a snapshot, then live events. Used to reconnect after a reload. */
  app.get("/sessions/:id/stream", async (c) => {
    const channel = new Channel<AgentEvent>();
    const detach = await runtime.attach(c.get("user"), c.req.param("id"), (event) => channel.push(event));
    return pipe(c, channel, undefined, detach);
  });

  app.post("/sessions/:id/abort", async (c) => {
    await runtime.abort(c.get("user"), c.req.param("id"));
    return c.body(null, 204);
  });
  app.post("/sessions/:id/steer", async (c) => {
    const { text } = await body<{ text: string }>(c);
    await runtime.steer(c.get("user"), c.req.param("id"), text ?? "");
    return c.body(null, 204);
  });
  app.post("/sessions/:id/approvals/:approvalId", async (c) => {
    const decision = await body<ApprovalDecision>(c);
    if (typeof decision.approved !== "boolean") throw new AgentError(400, "Send { approved: true | false }.");
    await runtime.decide(c.get("user"), c.req.param("id"), c.req.param("approvalId"), decision);
    return c.body(null, 204);
  });

  // Schedules -----------------------------------------------------------------
  const scheduler = () => {
    if (!runtime.scheduler) throw new AgentError(404, "Scheduling is turned off on this server.", "no_scheduler");
    return runtime.scheduler;
  };
  app.get("/schedules", (c) => c.json(runtime.scheduler?.list(c.get("user")) ?? []));
  app.post("/schedules", async (c) =>
    c.json(await scheduler().create(await body<CreateScheduleRequest>(c), c.get("user"), "user"), 201),
  );
  app.patch("/schedules/:id", async (c) =>
    c.json(await scheduler().update(c.req.param("id"), await body<UpdateScheduleRequest>(c), c.get("user"))),
  );
  app.delete("/schedules/:id", async (c) => {
    await scheduler().remove(c.req.param("id"), c.get("user"));
    return c.body(null, 204);
  });
  app.post("/schedules/:id/run", (c) => {
    scheduler().runNow(c.req.param("id"), c.get("user"));
    return c.body(null, 202);
  });

  // MCP -----------------------------------------------------------------------
  app.get("/mcp", (c) => c.json(runtime.mcp.info()));
  app.post("/mcp", async (c) => c.json(await runtime.addMcpServer(c.get("user"), await body<AddMcpServerRequest>(c)), 201));
  app.delete("/mcp/:name", async (c) => {
    await runtime.removeMcpServer(c.get("user"), c.req.param("name"));
    return c.body(null, 204);
  });

  // Notifications ---------------------------------------------------------------
  app.get("/events", (c) => {
    const channel = new Channel<NotificationEvent>();
    channel.push({ type: "hello", at: Date.now() });
    const unsubscribe = runtime.subscribe(c.get("user"), (event) => channel.push(event));
    return pipe(c, channel, undefined, unsubscribe);
  });

  return app;
}

export interface AgentServer {
  runtime: AgentRuntime;
  /** Hono app; mount with `app.route("/api/agent", server.app)`. */
  app: Hono<Env>;
  /** Web-standard handler for Bun, Deno, Cloudflare, Next.js route handlers... */
  fetch: (request: Request) => Response | Promise<Response>;
  /** Node/Express handler: `expressApp.use("/api/agent", server.nodeHandler)`. */
  nodeHandler: ReturnType<typeof getRequestListener>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Creates the runtime and its HTTP API in one go. */
export function createAgentServer(config: AgentRuntimeConfig & AgentHttpOptions): AgentServer {
  const runtime = new AgentRuntime(config);
  const app = createAgentRoutes(runtime, config);
  return {
    runtime,
    app,
    fetch: (request) => app.fetch(request),
    nodeHandler: getRequestListener((request) => app.fetch(request)),
    start: () => runtime.start(),
    stop: () => runtime.stop(),
  };
}

async function body<T>(c: Context, fallback?: T): Promise<T> {
  const text = await c.req.text();
  if (!text) {
    if (fallback !== undefined) return fallback;
    throw new AgentError(400, "This request needs a JSON body.", "bad_json");
  }
  return JSON.parse(text) as T;
}

/** Unbounded async queue between event producers and an SSE writer. */
class Channel<T> {
  private queue: T[] = [];
  private wake?: () => void;
  closed = false;

  push(item: T) {
    if (this.closed) return;
    this.queue.push(item);
    this.wake?.();
  }

  close() {
    this.closed = true;
    this.wake?.();
  }

  async next(): Promise<T | undefined> {
    while (!this.queue.length && !this.closed) {
      await new Promise<void>((resolve) => (this.wake = resolve));
      this.wake = undefined;
    }
    return this.queue.shift();
  }
}

function pipe<T>(c: Context, channel: Channel<T>, isLast: ((item: T) => boolean) | undefined, cleanup: () => void): Response {
  c.header("cache-control", "no-cache, no-transform");
  c.header("x-accel-buffering", "no");
  return streamSSE(c, async (stream) => {
    stream.onAbort(() => channel.close());
    const keepalive = setInterval(() => void stream.write(": keepalive\n\n").catch(() => channel.close()), KEEPALIVE_MS);
    try {
      for (;;) {
        const item = await channel.next();
        if (item === undefined) break;
        await stream.writeSSE({ data: JSON.stringify(item) });
        if (isLast?.(item)) break;
      }
    } finally {
      clearInterval(keepalive);
      channel.close();
      cleanup();
    }
  });
}
