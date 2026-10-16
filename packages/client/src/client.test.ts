import { describe, expect, it, vi } from "vitest";
import type { AgentConfigInfo, AgentEvent, SessionDetail } from "@klymbak/protocol";
import { createAgentClient } from "./client.ts";
import { describeCron } from "./format.ts";
import { renderMarkdown } from "./markdown.ts";
import { mediaMeta, mediaName, safeUrl } from "./media.ts";
import { observe } from "./observe.ts";
import { createAgentStore, selectCurrentModel } from "./store.ts";

const config: AgentConfigInfo = {
  app: { name: "Test" },
  user: { id: "u1", name: "Ada", roles: ["admin"] },
  models: [
    { provider: "p", providerName: "P", id: "m", name: "Model", reasoning: false, contextWindow: 1000, maxTokens: 100, input: ["text"], thinkingLevels: ["off"] },
  ],
  defaultModel: { provider: "p", id: "m" },
  tools: [],
  subagents: [],
  mcpServers: [],
  features: { schedules: false, steering: true, runtimeMcp: false, attachments: false },
};

function sse(events: AgentEvent[]): Response {
  const body = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

function fakeServer(runEvents: AgentEvent[]) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const session: SessionDetail = { id: "s1", title: "New conversation", createdAt: 1, updatedAt: 1, source: "chat", running: false, messages: [], allowedTools: [] };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("http://test", "");
    const method = init?.method ?? "GET";
    calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (path === "/config") return json(config);
    if (path === "/sessions" && method === "GET") return json([]);
    if (path === "/sessions" && method === "POST") return json(session, 201);
    if (path === "/sessions/s1/runs") return sse(runEvents);
    if (path === "/events") return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    return json({ error: "nope" }, 404);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

describe("agent store", () => {
  it("creates a session on first send and streams the run into messages", async () => {
    const server = fakeServer([
      { type: "run_start", runId: "r", sessionId: "s1", model: { provider: "p", id: "m" }, at: 1 },
      { type: "message_start", message: { id: "u", role: "user", parts: [{ type: "text", text: "hi" }], createdAt: 1, status: "done" } },
      { type: "message_start", message: { id: "a", role: "assistant", parts: [], createdAt: 1, status: "streaming" } },
      { type: "part_start", messageId: "a", index: 0, part: { type: "text", text: "" } },
      { type: "part_delta", messageId: "a", index: 0, delta: "Hel" },
      { type: "part_delta", messageId: "a", index: 0, delta: "lo" },
      { type: "message_end", message: { id: "a", role: "assistant", parts: [{ type: "text", text: "Hello" }], createdAt: 1, status: "done" } },
      { type: "run_end", runId: "r", status: "completed" },
    ]);
    const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch: server.fetch }), persist: false });
    await store.init();
    expect(store.state.model).toEqual({ provider: "p", id: "m" });
    expect(selectCurrentModel(store.state)?.name).toBe("Model");

    const listener = vi.fn();
    store.subscribe(listener);
    await store.send("hi");
    expect(store.state.sessionId).toBe("s1");
    expect(store.state.running).toBe(false);
    expect(store.state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(store.state.messages[1]!.parts).toEqual([{ type: "text", text: "Hello" }]);
    expect(server.calls.find((c) => c.path === "/sessions/s1/runs")?.body).toMatchObject({ prompt: "hi", model: { provider: "p", id: "m" } });
    expect(listener).toHaveBeenCalled();
    store.dispose();
  });

  it("sends the host app's page context with every run until it is cleared", async () => {
    const server = fakeServer([{ type: "run_end", runId: "r", status: "completed" }]);
    const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch: server.fetch }), persist: false });
    await store.init();
    store.setContext("Article «Hello» (documentId abc)");
    await store.send("Summarize it");
    store.setContext(undefined);
    await store.send("Thanks");

    const runs = server.calls.filter((c) => c.path === "/sessions/s1/runs").map((c) => c.body as { context?: string });
    expect(runs.map((body) => body.context)).toEqual(["Article «Hello» (documentId abc)", undefined]);
    store.dispose();
  });

  it("reports server errors in plain language", async () => {
    const fetch = vi.fn(async () => new Response("bad gateway", { status: 502 })) as unknown as typeof globalThis.fetch;
    const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch }), persist: false });
    await store.init();
    expect(store.state.error).toContain("isn't responding");
  });

  it("bumps the version on every change and notifies subscribers once per batch", async () => {
    const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch: fakeServer([]).fetch }), persist: false });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const before = store.getVersion();

    store.toast({ tone: "info", title: "One" }, 0);
    store.toast({ tone: "info", title: "Two" }, 0);
    expect(store.getVersion()).toBeGreaterThan(before);
    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.state.toasts.map((t) => t.title)).toEqual(["One", "Two"]);

    unsubscribe();
    store.dismissToast(store.state.toasts[0]!.id);
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("loads again and resubscribes when initialized after dispose", async () => {
    const server = fakeServer([]);
    const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch: server.fetch }), persist: false });
    await store.init();
    await store.init();
    store.dispose();
    await store.init();
    expect(server.calls.filter((c) => c.path === "/config")).toHaveLength(2);
    expect(server.calls.filter((c) => c.path === "/events")).toHaveLength(2);
    store.dispose();
  });

  it("leaves change tracking to the framework when given a reactive wrapper", () => {
    const wrapped: object[] = [];
    const store = createAgentStore({
      client: createAgentClient({ baseUrl: "http://test", fetch: fakeServer([]).fetch }),
      persist: false,
      reactive: (state) => {
        wrapped.push(state);
        return state;
      },
    });
    store.toast({ tone: "info", title: "One" }, 0);
    expect(wrapped).toEqual([store.state]);
    expect(store.getVersion()).toBe(0);
  });
});

describe("observe", () => {
  it("reports writes at any depth, skips no-op writes and keeps proxies stable", () => {
    const onChange = vi.fn();
    const state = observe({ flag: false, items: [{ n: 1 }] }, onChange);

    state.items[0]!.n = 2;
    expect(onChange).toHaveBeenCalledTimes(1);
    state.flag = false;
    expect(onChange).toHaveBeenCalledTimes(1);
    state.items.push({ n: 3 });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(state.items[0]).toBe(state.items[0]);

    // Arrays built from proxied items must not wrap them a second time.
    state.items = state.items.filter((item) => item.n > 2);
    const item = state.items[0]!;
    expect(state.items[0]).toBe(item);
    item.n = 4;
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(state.items).toEqual([{ n: 4 }]);
  });

  it("leaves frozen objects and class instances alone", () => {
    const date = new Date(0);
    const frozen = Object.freeze({ n: 1 });
    const state = observe({ date, frozen }, () => undefined);
    expect(state.date).toBe(date);
    expect(state.frozen).toBe(frozen);
  });
});

describe("format", () => {
  it("describes common cron patterns", () => {
    expect(describeCron("0 8 * * 1-5")).toBe("Weekdays at 08:00");
    expect(describeCron("0 9 * * 1")).toBe("Every Monday at 09:00");
    expect(describeCron("0 */4 * * *")).toBe("Every 4 hours");
    expect(describeCron("15 3 1-7 * 2")).toBe("15 3 1-7 * 2");
  });
});

describe("media", () => {
  it("keeps http(s) URLs and paths, never script or data URLs", () => {
    expect(safeUrl("/uploads/cat.png")).toBe("/uploads/cat.png");
    expect(safeUrl("https://cdn.example.com/cat.png")).toBe("https://cdn.example.com/cat.png");
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("java	script:alert(1)")).toBeUndefined();
    expect(safeUrl(" JavaScript:alert(1)")).toBeUndefined();
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeUndefined();
    expect(safeUrl(42)).toBeUndefined();
  });

  it("names and describes files from what is known", () => {
    expect(mediaName({ url: "/uploads/my%20cat_1a2b.png?v=2" })).toBe("my cat_1a2b.png");
    expect(mediaMeta({ url: "/uploads/cat_1a2b.png", name: "cat.png", mime: "image/png", width: 1024, height: 768 })).toBe("PNG · 1024×768");
    expect(mediaMeta({ url: "https://files.example.com/download/42", mime: "application/pdf" })).toBe("PDF");
    expect(mediaMeta({ url: "https://files.example.com/download/42" })).toBe("");
  });
});

describe("markdown", () => {
  it("loads images only from the page's origin and links the rest", () => {
    expect(renderMarkdown("![Cover](/uploads/cover.png)")).toContain('<img src="/uploads/cover.png" alt="Cover">');
    expect(renderMarkdown("![Cover](http://localhost/uploads/cover.png)")).toContain("<img");
    for (const src of ["https://attacker.example/x.png?q=secret", "//attacker.example/x.png"]) {
      const html = renderMarkdown(`![Cover](${src})`);
      expect(html).not.toContain("<img");
      expect(html).toContain('target="_blank" rel="noopener noreferrer">Cover</a>');
    }
    expect(renderMarkdown("![](https://attacker.example/x.png)")).toContain(">https://attacker.example/x.png</a>");
  });
});
