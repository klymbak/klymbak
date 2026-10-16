// @vitest-environment happy-dom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfigInfo, AgentEvent, ChatMessage, MediaBlock, SessionDetail, TableBlock } from "@klymbak/protocol";
import { createAgentClient, createAgentStore, formatValue, type AgentStore } from "@klymbak/client";
import { ChatActionsProvider, StoreProvider } from "./context";
import { AgentChat } from "./components/AgentChat";
import { AgentWidget } from "./components/AgentWidget";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { ApprovalPrompt } from "./components/ApprovalPrompt";
import { DataTable } from "./components/blocks/DataTable";
import { MediaGallery } from "./components/blocks/MediaGallery";
import { MessageItem } from "./components/MessageItem";
import { ToastStack } from "./components/ToastStack";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function render(node: ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

const button = (container: Element, text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

async function click(element: Element | null | undefined) {
  if (!element) throw new Error("Nothing to click");
  await act(async () => (element as HTMLElement).click());
}

/** Sets a field's value the way typing does, so React's onChange fires. */
async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!;
  await act(async () => {
    setter.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const config: AgentConfigInfo = {
  app: { name: "Test", suggestions: ["Show orders"] },
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

/** A store on a fake server. Each run streams the next list of events. */
function testStore(...runs: AgentEvent[][]) {
  const session: SessionDetail = { id: "s1", title: "Orders", createdAt: 1, updatedAt: 1, source: "chat", running: false, messages: [], allowedTools: [] };
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("http://test", "");
    const method = init?.method ?? "GET";
    if (path === "/config") return json(config);
    if (path === "/sessions" && method === "GET") return json([]);
    if (path === "/sessions" && method === "POST") return json(session, 201);
    if (path === "/sessions/s1/runs") return sse(runs.shift() ?? []);
    if (path === "/events") return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    return json({ error: "nope" }, 404);
  }) as unknown as typeof globalThis.fetch;
  const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch }), persist: false });
  cleanups.push(() => store.dispose());
  return store;
}

describe("AgentChat", () => {
  it("re-renders as the store loads and streams a run", async () => {
    const store = testStore([
      { type: "run_start", runId: "r", sessionId: "s1", model: { provider: "p", id: "m" }, at: 1 },
      { type: "message_start", message: { id: "u", role: "user", parts: [{ type: "text", text: "Show orders" }], createdAt: 1, status: "done" } },
      { type: "message_start", message: { id: "a", role: "assistant", parts: [], createdAt: 1, status: "streaming" } },
      { type: "part_start", messageId: "a", index: 0, part: { type: "text", text: "" } },
      { type: "part_delta", messageId: "a", index: 0, delta: "Two **orders**" },
      { type: "message_end", message: { id: "a", role: "assistant", parts: [{ type: "text", text: "Two **orders**" }], createdAt: 1, status: "done" } },
      { type: "run_end", runId: "r", status: "completed" },
    ]);
    const container = render(<AgentChat store={store} />);
    await act(() => store.init());
    expect(container.querySelector(".kl-models__name")?.textContent).toBe("Model");
    expect(container.querySelector(".kl-welcome__title")?.textContent).toBe("Test");

    await click(button(container, "Show orders"));
    await act(async () => {
      await vi.waitFor(() => expect(store.state.running).toBe(false));
    });
    expect(container.querySelector(".kl-chat__title")?.textContent).toBe("Orders");
    expect(container.querySelector(".kl-msg--user")?.textContent).toBe("Show orders");
    expect(container.querySelector(".kl-msg--assistant .kl-md")?.innerHTML).toContain("<strong>orders</strong>");
  });

  it("sends its context with each run and clears it on unmount", async () => {
    const store = testStore([{ type: "run_end", runId: "r", status: "completed" }]);
    const run = vi.spyOn(store.client, "run");
    const container = render(<AgentChat store={store} context="Order #1042 is open" />);
    await act(() => store.init());

    await click(button(container, "Show orders"));
    await act(async () => {
      await vi.waitFor(() => expect(store.state.running).toBe(false));
    });
    expect(run.mock.calls[0]![1]).toMatchObject({ prompt: "Show orders", context: "Order #1042 is open" });

    const setContext = vi.spyOn(store, "setContext");
    cleanups.pop()!(); // unmounts the chat
    expect(setContext).toHaveBeenCalledWith(undefined);
  });

  it("re-renders only the message that is streaming", async () => {
    const renders = vi.fn();
    function OrdersResult() {
      renders();
      return <span className="orders-result">2 orders</span>;
    }
    const start = (n: number): AgentEvent[] => [
      { type: "run_start", runId: `r${n}`, sessionId: "s1", model: { provider: "p", id: "m" }, at: n },
      { type: "message_start", message: { id: `u${n}`, role: "user", parts: [{ type: "text", text: `Question ${n}` }], createdAt: n, status: "done" } },
      { type: "message_start", message: { id: `a${n}`, role: "assistant", parts: [], createdAt: n, status: "streaming" } },
    ];
    const tool = { type: "tool" as const, toolCallId: "t", name: "list_orders", status: "done" as const, result: { text: "2 orders", isError: false } };
    const store = testStore(
      [
        ...start(1),
        { type: "part_start", messageId: "a1", index: 0, part: tool },
        { type: "message_end", message: { id: "a1", role: "assistant", parts: [tool], createdAt: 1, status: "done" } },
        { type: "run_end", runId: "r1", status: "completed" },
      ],
      [
        ...start(2),
        { type: "part_start", messageId: "a2", index: 0, part: { type: "text", text: "" } },
        ...["One ", "two ", "three ", "four ", "five"].map((delta): AgentEvent => ({ type: "part_delta", messageId: "a2", index: 0, delta })),
        { type: "message_end", message: { id: "a2", role: "assistant", parts: [{ type: "text", text: "One two three four five" }], createdAt: 2, status: "done" } },
        { type: "run_end", runId: "r2", status: "completed" },
      ],
    );
    const container = render(<AgentChat store={store} renderers={{ tools: { list_orders: OrdersResult } }} />);
    await act(() => store.init());
    await act(() => store.send("Question 1"));
    expect(container.querySelector(".orders-result")).not.toBeNull();
    const afterFirstRun = renders.mock.calls.length;

    await act(() => store.send("Question 2"));
    expect(container.querySelectorAll(".kl-msg--assistant")[1]?.textContent).toContain("One two three four five");
    expect(renders.mock.calls.length).toBe(afterFirstRun);
  });
});

describe("AgentWidget", () => {
  it("opens and closes the chat panel", async () => {
    const container = render(<AgentWidget store={testStore()} label="Ask Acme" />);
    const panel = container.querySelector<HTMLElement>(".kl-widget__panel")!;
    expect(panel.style.display).toBe("none");

    await click(button(container, "Ask Acme"));
    expect(panel.style.display).toBe("");
    expect(button(container, "Ask Acme")).toBeUndefined();

    await click(container.querySelector("[aria-label=Close]"));
    expect(panel.className).toContain("kl-widget-leave-active");
    await act(async () => panel.dispatchEvent(new Event("transitionend")));
    expect(panel.style.display).toBe("none");
    expect(panel.className).toBe("kl-widget__panel");
  });

  it("does not animate on mount under StrictMode, except toasts that appear", async () => {
    const store = testStore();
    const container = render(
      <StrictMode>
        <AgentWidget store={store} defaultOpen />
      </StrictMode>,
    );
    expect(container.querySelector(".kl-widget__panel")!.className).toBe("kl-widget__panel");

    await act(async () => store.toast({ tone: "info", title: "Saved" }, 0));
    expect(container.querySelector(".kl-toast")!.className).toContain("kl-toast-enter-active");
  });
});

describe("AgentWorkspace", () => {
  it("lists conversations, opens one and renames it", async () => {
    const now = Date.now();
    const summary = { id: "s9", title: "Refund for Jane", createdAt: now, updatedAt: now, source: "chat" as const, running: false };
    const detail: SessionDetail = {
      ...summary,
      messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "Refund Jane's tent" }], createdAt: now, status: "done" }],
      allowedTools: [],
    };
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace("http://test", "");
      const method = init?.method ?? "GET";
      calls.push(`${method} ${path}`);
      if (path === "/config") return json(config);
      if (path === "/sessions") return json([summary]);
      if (path === "/sessions/s9" && method === "GET") return json(detail);
      if (path === "/sessions/s9" && method === "PATCH") return json({ ...summary, title: JSON.parse(String(init!.body)).title });
      if (path === "/events") return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
      return json({ error: "nope" }, 404);
    }) as unknown as typeof globalThis.fetch;
    const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch }), persist: false });
    cleanups.push(() => store.dispose());

    const container = render(<AgentWorkspace store={store} />);
    await act(() => store.init());
    expect(container.querySelector(".kl-workspace__app")?.textContent).toBe("Test");
    expect(container.querySelector(".kl-sessions__label")?.textContent).toBe("Today");

    await click(container.querySelector(".kl-session__open"));
    await act(async () => {
      await vi.waitFor(() => expect(store.state.messages).toHaveLength(1));
    });
    expect(container.querySelector(".kl-chat__title")?.textContent).toBe("Refund for Jane");
    expect(container.querySelector(".kl-session--active")).not.toBeNull();
    expect(container.querySelector(".kl-msg--user")?.textContent).toBe("Refund Jane's tent");

    await click(container.querySelector("[aria-label=Rename]"));
    const input = container.querySelector<HTMLInputElement>(".kl-session__rename")!;
    await type(input, "Jane's refund");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector(".kl-session__title")?.textContent).toBe("Jane's refund"));
    });
    expect(calls.filter((c) => c === "PATCH /sessions/s9")).toHaveLength(1);

    await click(button(container, "Tools"));
    expect(container.querySelector(".kl-caps__intro")?.textContent).toContain("Ada");
  });
});

describe("ToastStack", () => {
  it("keeps a dismissed toast in place until it has animated out", async () => {
    const store = testStore();
    const container = render(
      <StrictMode>
        <StoreProvider value={store}>
          <ToastStack />
        </StoreProvider>
      </StrictMode>,
    );
    await act(async () => {
      store.toast({ tone: "info", title: "First" }, 0);
      store.toast({ tone: "success", title: "Second" }, 0);
    });
    const [first, second] = container.querySelectorAll<HTMLElement>(".kl-toast");

    await act(async () => store.dismissToast(store.state.toasts[0]!.id));
    expect([...container.querySelectorAll(".kl-toast")]).toEqual([first, second]);
    expect(first!.className).toContain("kl-toast-leave-active");
    expect(first!.className).not.toContain("kl-toast-enter");

    await act(async () => first!.dispatchEvent(new Event("transitionend")));
    expect([...container.querySelectorAll(".kl-toast")]).toEqual([second]);
  });
});

describe("components", () => {
  it("sorts table columns and fills row-action prompts", async () => {
    const sendPrompt = vi.fn();
    const block: TableBlock = {
      type: "table",
      title: "Orders",
      columns: [
        { key: "id", label: "Order", format: "code" },
        { key: "total", label: "Total", format: "currency" },
      ],
      rows: [
        { id: 1, total: 20 },
        { id: 2, total: 99.5 },
      ],
      rowActions: [{ label: "Details", prompt: "Show order #{id}" }],
    };
    const container = render(
      <ChatActionsProvider value={{ sendPrompt, emitAction: () => undefined }}>
        <DataTable block={block} />
      </ChatActionsProvider>,
    );
    const totals = () => [...container.querySelectorAll("tbody tr")].map((tr) => tr.querySelectorAll("td")[1]!.textContent);
    expect(totals()).toEqual([formatValue(20, "currency"), formatValue(99.5, "currency")]);

    await click(container.querySelectorAll("th button")[1]);
    expect(totals()[0]).toBe(formatValue(99.5, "currency"));

    await click(container.querySelector("tbody tr .kl-table__row-actions button"));
    expect(sendPrompt).toHaveBeenCalledWith("Show order #2");
  });

  it("previews files, opens them in a new tab and never links a script URL", async () => {
    const block: MediaBlock = {
      type: "media",
      title: "Results",
      items: [
        { url: "/uploads/cover.png", name: "cover.png", alt: "A red door", mime: "image/png", width: 1024, height: 768 },
        { url: "/uploads/terms.pdf", name: "terms.pdf", mime: "application/pdf" },
        { url: "javascript:alert(1)", name: "trap.png" },
        ...Array.from({ length: 12 }, (_, i) => ({ url: `/uploads/${i}.jpg` })),
      ],
    };
    const container = render(<MediaGallery block={block} />);
    const tiles = () => container.querySelectorAll(".kl-media__item");
    const image = tiles()[0]!.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/uploads/cover.png");
    expect(image.alt).toBe("A red door");
    expect(tiles()[0]!.querySelector("a")?.target).toBe("_blank");
    expect(tiles()[0]!.querySelector(".kl-media__meta")?.textContent).toBe("PNG · 1024×768");
    expect(tiles()[1]!.querySelector("a")?.getAttribute("href")).toBe("/uploads/terms.pdf");
    expect(tiles()[1]!.querySelector(".kl-media__file")?.textContent).toBe("PDF");
    expect(tiles()[2]!.querySelector("a, img")).toBeNull();
    expect(container.querySelector(".kl-media__count")?.textContent).toBe("15 files");
    expect(tiles()).toHaveLength(12);
    await click(button(container, "Show 3 more"));
    expect(tiles()).toHaveLength(15);
  });

  it("asks for a reason before denying and sends the decision to the store", async () => {
    const decide = vi.fn(async () => undefined);
    const container = render(
      <StoreProvider value={{ decide } as unknown as AgentStore}>
        <ApprovalPrompt approval={{ id: "ap1", title: "Refund $80", status: "pending", risk: "high", rememberable: true }} />
      </StoreProvider>,
    );
    expect(container.textContent).toContain("Refund $80");
    await click(button(container, "Deny"));
    expect(decide).not.toHaveBeenCalled();
    await type(container.querySelector<HTMLInputElement>("input[type=text]")!, "Too much");
    await click(button(container, "Confirm deny"));
    expect(decide).toHaveBeenCalledWith("ap1", { approved: false, reason: "Too much", remember: false });
  });

  it("renders tool cards with their status and UI blocks", () => {
    const message: ChatMessage = {
      id: "a",
      role: "assistant",
      createdAt: 1,
      status: "done",
      parts: [
        { type: "text", text: "Here you go" },
        {
          type: "tool",
          toolCallId: "t",
          name: "list_orders",
          label: "List orders",
          status: "done",
          durationMs: 12,
          result: { text: "2 orders", isError: false, ui: [{ type: "stats", items: [{ label: "Orders", value: 2, format: "integer" }] }] },
        },
      ],
    };
    const container = render(<MessageItem message={message} />);
    expect(container.querySelector(".kl-tool__name")?.textContent).toBe("List orders");
    expect(container.querySelector(".kl-tool .kl-pill")?.textContent).toBe("Done");
    expect(container.querySelector(".kl-stat__value")?.textContent).toBe("2");
    expect(container.querySelector(".kl-md")?.innerHTML).toContain("Here you go");
  });

  it("escapes HTML in model output", () => {
    const message: ChatMessage = {
      id: "a",
      role: "assistant",
      createdAt: 1,
      status: "done",
      parts: [{ type: "text", text: '<img src=x onerror="alert(1)"> **bold**' }],
    };
    const html = render(<MessageItem message={message} />).querySelector(".kl-md")!.innerHTML;
    expect(html).not.toContain("<img");
    expect(html).toContain("<strong>bold</strong>");
  });
});
