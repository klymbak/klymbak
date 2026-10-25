// @vitest-environment happy-dom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfigInfo, AgentEvent, ApprovalInboxItem, ApprovalView, ChatMessage, MediaBlock, SessionDetail, SourcesBlock, TableBlock } from "@klymbak/protocol";
import { createAgentClient, createAgentStore, formatValue, type AgentStore } from "@klymbak/client";
import de from "@klymbak/client/locales/de";
import { ChatActionsProvider, KlymbakProvider, StoreProvider } from "./context";
import { AgentChat } from "./components/AgentChat";
import { AgentWidget } from "./components/AgentWidget";
import { AgentWorkspace } from "./components/AgentWorkspace";
import { ApprovalPrompt } from "./components/ApprovalPrompt";
import { CapabilitiesPanel } from "./components/CapabilitiesPanel";
import { Composer } from "./components/Composer";
import { DataTable } from "./components/blocks/DataTable";
import { MediaGallery } from "./components/blocks/MediaGallery";
import { SourceList } from "./components/blocks/SourceList";
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
  skills: [],
  mcpServers: [],
  resources: [],
  resourceTemplates: [],
  prompts: [],
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

  it("offers the approval inbox while approvals wait, where a drafted reply can be edited before approving", async () => {
    const waiting: ApprovalInboxItem = {
      sessionId: "s7",
      sessionTitle: "Ticket #7",
      source: "api",
      tool: "send_reply",
      label: "Reply to customer",
      createdAt: Date.now() - 60_000,
      approval: { id: "ap1", title: "Reply on ticket #7", status: "pending", waits: true, fields: [{ name: "body", label: "Reply", value: "Your parcel is lost.", multiline: true }] },
    };
    let inbox = [waiting];
    const decisions: unknown[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace("http://test", "");
      if (path === "/config") return json(config);
      if (path === "/sessions") return json([]);
      if (path === "/approvals") return json(inbox);
      if (path === "/sessions/s7/approvals/ap1") {
        decisions.push(JSON.parse(String(init!.body)));
        inbox = [];
        return new Response(null, { status: 204 });
      }
      if (path === "/sessions/s7") return json({ id: "s7", title: "Ticket #7", createdAt: 1, updatedAt: 1, source: "api", running: false, messages: [], allowedTools: [] });
      if (path === "/events") return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
      return json({ error: "nope" }, 404);
    }) as unknown as typeof globalThis.fetch;
    const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch }), persist: false });
    cleanups.push(() => store.dispose());

    const container = render(<AgentWorkspace store={store} locale="en" />);
    await act(() => store.init());
    await act(async () => {
      await vi.waitFor(() => expect(container.querySelector(".kl-workspace__inbox")?.textContent).toBe("Approvals1"));
    });
    await click(container.querySelector(".kl-workspace__inbox"));
    const inboxView = container.querySelector(".kl-inbox")!;
    expect(container.querySelector(".kl-chat")!.closest<HTMLElement>(".kl-workspace__view")!.hidden).toBe(true);
    expect(inboxView.querySelector(".kl-inbox__meta")?.textContent).toBe("Ticket #7Background job · 1 minute ago");
    expect(inboxView.querySelector(".kl-approval__title")?.textContent).toBe("Reply on ticket #7");

    await type(inboxView.querySelector("textarea")!, "Your parcel is on its way.");
    await click(button(inboxView, "Approve"));
    expect(decisions).toEqual([{ approved: true, remember: false, edits: { body: "Your parcel is on its way." } }]);
    expect(container.querySelector(".kl-inbox__empty")?.textContent).toBe("Nothing is waiting for your approval.");
    expect(container.querySelector(".kl-workspace__badge")).toBeNull();

    // The entry stays while the inbox is open; going back to the chats hides it.
    await click(container.querySelector(".kl-sessions__new"));
    expect(container.querySelector(".kl-inbox")).toBeNull();
    expect(container.querySelector(".kl-workspace__inbox")).toBeNull();
  });

  it("speaks the provider's language, with a component's own messages on top", async () => {
    const store = testStore();
    const container = render(
      <KlymbakProvider store={store} locale="de" messages={de}>
        <AgentWorkspace messages={overrides} title="Redaktion" description="Fragen Sie mich etwas." />
      </KlymbakProvider>,
    );
    await act(() => store.init());
    expect(button(container, "Werkzeuge")).toBeDefined();
    expect(button(container, "Neues Gespräch")).toBeDefined();
    expect(container.querySelector(".kl-chat")?.getAttribute("aria-label")).toBe("Chat mit dem Agenten");
    expect(container.querySelector(".kl-composer__input")?.getAttribute("placeholder")).toBe(de["composer.placeholder"]);
    expect(container.querySelector(".kl-welcome__title")?.textContent).toBe("Redaktion");
    expect(container.querySelector(".kl-welcome__text")?.textContent).toBe("Fragen Sie mich etwas.");

    await act(async () => store.toast({ tone: "info", title: { id: "toast.taskStarted" }, body: "As is" }, 0));
    expect(container.querySelector(".kl-toast strong")?.textContent).toBe("Aufgabe gestartet");
    expect(container.querySelector(".kl-toast p")?.textContent).toBe("As is");
  });
});

const overrides = { "chat.newChat": "Neues Gespräch" };

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

  it("cites sources with links, where each passage is, and a long excerpt that opens", async () => {
    const block: SourcesBlock = {
      type: "sources",
      items: [
        { title: "Returns and refunds", url: "https://help.acme.test/returns", source: "Help center", location: "Damaged items", excerpt: "If an item arrives damaged, we send a replacement." },
        { title: "Torn rainfly", url: "javascript:alert(1)", source: "Resolved tickets", excerpt: "We sent a replacement rainfly. ".repeat(12).trim() },
        ...Array.from({ length: 4 }, (_, i) => ({ title: `Page ${i + 3}` })),
      ],
    };
    const container = render(<SourceList block={block} />);
    const items = () => container.querySelectorAll(".kl-sources__item");
    expect(container.querySelector(".kl-sources__title")?.textContent).toBe("Sources");
    expect(container.querySelector(".kl-sources__count")?.textContent).toBe("6 sources");
    const link = items()[0]!.querySelector("a")!;
    expect([link.getAttribute("href"), link.target, link.textContent]).toEqual(["https://help.acme.test/returns", "_blank", "Returns and refunds"]);
    expect(items()[0]!.querySelector(".kl-sources__where")?.textContent).toBe("Help center · Damaged items");
    expect(items()[0]!.querySelector(".kl-sources__excerpt")?.textContent).toBe("If an item arrives damaged, we send a replacement.");
    expect(items()[0]!.querySelector("button")).toBeNull();
    // A script URL never becomes a link; a long excerpt shows three lines until opened.
    expect(items()[1]!.querySelector("a")).toBeNull();
    expect(items()[1]!.querySelector(".kl-sources__excerpt")?.classList.contains("kl-sources__excerpt--clamped")).toBe(true);
    await click(button(container, "Read the whole passage"));
    expect(items()[1]!.querySelector(".kl-sources__excerpt")?.classList.contains("kl-sources__excerpt--clamped")).toBe(false);
    expect(items()[1]!.querySelector("button")?.getAttribute("aria-expanded")).toBe("true");
    expect(items()).toHaveLength(4);
    await click(button(container, "Show 2 more"));
    expect(items()).toHaveLength(6);
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
    expect(decide).toHaveBeenCalledWith("ap1", { approved: false, reason: "Too much", remember: false }, undefined);
  });

  it("sends only the fields a person changed, and shows that the approval was edited", async () => {
    const decide = vi.fn(async () => true);
    const approval: ApprovalView = {
      id: "ap2",
      title: "Reply on ticket #7",
      status: "pending",
      fields: [
        { name: "body", label: "Reply", value: "Draft", multiline: true },
        { name: "subject", label: "Subject", value: "Your order", multiline: false },
      ],
    };
    const container = render(
      <StoreProvider value={{ decide } as unknown as AgentStore}>
        <ApprovalPrompt approval={approval} sessionId="s7" />
      </StoreProvider>,
    );
    expect([...container.querySelectorAll(".kl-approval__fields .kl-label")].map((label) => label.firstChild?.textContent)).toEqual(["Reply", "Subject"]);
    expect(container.querySelector<HTMLInputElement>(".kl-approval__fields input")!.value).toBe("Your order");
    await type(container.querySelector("textarea")!, "Better draft");
    await click(button(container, "Approve"));
    expect(decide).toHaveBeenCalledWith("ap2", { approved: true, remember: false, edits: { body: "Better draft" } }, "s7");

    const decided = render(<ApprovalPrompt approval={{ ...approval, status: "approved", decidedBy: "Sam", edited: true }} />);
    expect(decided.querySelector(".kl-approval__summary .kl-faint")?.textContent).toBe("by Sam · edited");
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

  it("mentions MCP resources with @, starts with a prompt from / and sends both", async () => {
    const resources = [
      { server: "carrier", uri: "carrier://zones", name: "Shipping zones" },
      { server: "carrier", uri: "carrier://policies/returns", name: "Return policy", description: "When returns are free" },
    ];
    const prompts = [{ server: "carrier", name: "delay_notice", title: "Delay notice", arguments: [{ name: "trackingNumber", required: true }] }];
    const onSend = vi.fn();
    const container = render(<Composer resources={resources} prompts={prompts} onSend={onSend} />);
    const box = container.querySelector("textarea")!;
    const options = () => [...container.querySelectorAll("[role=option] .kl-mention-menu__name")].map((o) => o.textContent);
    const key = (name: string) => act(async () => void box.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })));

    act(() => box.focus());
    await type(box, "/del");
    expect(options()).toEqual(["Delay notice"]);
    await key("Enter");
    expect(container.querySelector(".kl-ref--prompt")?.textContent).toBe("/Delay notice");
    expect(box.value).toBe("");
    expect(container.querySelector<HTMLButtonElement>(".kl-composer__send")!.disabled).toBe(true);
    expect(document.activeElement).toBe(container.querySelector(".kl-composer__arg"));
    await type(container.querySelector<HTMLInputElement>(".kl-composer__arg")!, "AC123");

    act(() => box.focus());
    await type(box, "Mention @ret");
    expect(container.querySelector("[role=listbox]")?.getAttribute("aria-label")).toBe("Resources");
    expect(options()).toEqual(["Return policy"]);
    expect(box.getAttribute("aria-activedescendant")).toBe(container.querySelector("[role=option]")!.id);
    await key("Enter");
    expect(box.value).toBe("Mention @Return policy ");
    expect(container.querySelector("[role=listbox]")).toBeNull();

    await key("Enter");
    expect(onSend).toHaveBeenCalledWith("Mention @Return policy ", [], { resources: [resources[1]], templates: [], prompt: prompts[0], arguments: { trackingNumber: "AC123" } });
    expect(container.querySelector(".kl-ref")).toBeNull();
  });

  it("mentions a resource template, asks for its values with the server's suggestions, and sends it", async () => {
    vi.useFakeTimers();
    const resourceTemplates = [{ server: "carrier", uriTemplate: "carrier://shipments/{trackingNumber}{?events}", name: "Shipment", completes: true }];
    const complete = vi.fn(async ({ value }: { value: string }) => ["AC123", "AC124"].filter((v) => v.startsWith(value)));
    const onSend = vi.fn();
    const container = render(<Composer resourceTemplates={resourceTemplates} complete={complete} onSend={onSend} />);
    const box = container.querySelector("textarea")!;
    const key = (name: string) => act(async () => void box.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })));

    act(() => box.focus());
    await type(box, "Where is @sh");
    expect(container.querySelector("[role=option] .kl-mention-menu__detail")?.textContent).toBe("carrier://shipments/{trackingNumber}{?events}");
    await key("Enter");
    expect(box.value).toBe("Where is @Shipment ");
    const [tracking, events] = [...container.querySelectorAll<HTMLInputElement>(".kl-composer__arg")];
    expect([tracking!.placeholder, events!.placeholder]).toEqual(["trackingNumber", "events (optional)"]);
    expect(document.activeElement).toBe(tracking);
    expect(container.querySelector<HTMLButtonElement>(".kl-composer__send")!.disabled).toBe(true);

    await type(tracking!, "AC12");
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(complete).toHaveBeenLastCalledWith({ server: "carrier", template: resourceTemplates[0]!.uriTemplate, argument: "trackingNumber", value: "AC12", context: undefined });
    const list = container.querySelector(`datalist[id="${tracking!.getAttribute("list")}"]`)!;
    expect([...list.querySelectorAll("option")].map((o) => o.value)).toEqual(["AC123", "AC124"]);

    await type(tracking!, "AC123");
    await key("Enter");
    expect(onSend.mock.calls[0]![2]).toMatchObject({ templates: [{ template: resourceTemplates[0], values: { trackingNumber: "AC123" } }] });
    vi.useRealTimers();
  });

  it("shows the MCP servers' prompts and resources in the Tools panel, a few resources at a time", async () => {
    const resources = Array.from({ length: 12 }, (_, i) => ({ server: "docs", uri: `docs://page-${i}`, name: `Page ${i}` }));
    const withMcp: AgentConfigInfo = {
      ...config,
      resources,
      resourceTemplates: [{ server: "carrier", uriTemplate: "carrier://shipments/{trackingNumber}", name: "Shipment" }],
      prompts: [{ server: "carrier", name: "delay_notice", title: "Delay notice", arguments: [] }],
    };
    const container = render(
      <StoreProvider value={{ state: { config: withMcp } } as unknown as AgentStore}>
        <CapabilitiesPanel />
      </StoreProvider>,
    );
    const section = (title: string) => [...container.querySelectorAll(".kl-caps__section")].find((s) => s.querySelector("h4")!.textContent!.trim().startsWith(title))!;
    expect(section("Prompts").querySelector(".kl-cap__name")?.textContent).toBe("/Delay notice");
    expect(section("Resources").querySelectorAll(".kl-cap")).toHaveLength(10);
    await click(section("Resources").querySelector(".kl-caps__more"));
    expect([...section("Resources").querySelectorAll(".kl-cap__uri")].at(-1)!.textContent).toBe("carrier://shipments/{trackingNumber}");
    expect(section("Resources").querySelector(".kl-caps__more")!.textContent).toBe("Show fewer");
  });

  it("closes the mention menu on Escape and shows a message's resources and prompt as chips", async () => {
    const onSend = vi.fn();
    const container = render(<Composer resources={[{ server: "s", uri: "s://a", name: "Alpha" }]} onSend={onSend} />);
    const box = container.querySelector("textarea")!;
    const key = (name: string) => act(async () => void box.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })));
    act(() => box.focus());
    await type(box, "@a");
    expect(container.querySelector("[role=listbox]")).not.toBeNull();
    await key("Escape");
    expect(container.querySelector("[role=listbox]")).toBeNull();
    await key("Enter");
    expect(onSend.mock.calls[0]![0]).toBe("@a");

    const message: ChatMessage = {
      id: "u",
      role: "user",
      createdAt: 1,
      status: "done",
      parts: [
        { type: "prompt", server: "s", name: "delay_notice", title: "Delay notice", arguments: { trackingNumber: "AC123" } },
        { type: "text", text: "Mention @Alpha" },
        { type: "resource", server: "s", uri: "s://a", name: "Alpha" },
      ],
    };
    const item = render(<MessageItem message={message} />);
    expect([...item.querySelectorAll(".kl-ref__name")].map((name) => name.textContent)).toEqual(["/Delay notice", "Alpha"]);
    expect(item.querySelector(".kl-ref__detail")?.textContent).toBe("AC123");
    expect(item.querySelector(".kl-msg__text")?.textContent).toBe("Mention @Alpha");
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
