import { Component, input, type Provider, type Type } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentConfigInfo, AgentEvent, ChatMessage, MediaBlock, SessionDetail, TableBlock, ToolPart } from "@klymbak/protocol";
import { createAgentClient, createAgentStore, formatValue, type AgentStore } from "@klymbak/client";
import de from "@klymbak/client/locales/de";
import fr from "@klymbak/client/locales/fr";
import { CHAT_ACTIONS, injectAgentState, provideAgentStore, provideKlymbak } from "./context.ts";
import { AgentChat } from "./components/AgentChat.ts";
import { AgentWidget } from "./components/AgentWidget.ts";
import { AgentWorkspace } from "./components/AgentWorkspace.ts";
import { CapabilitiesPanel } from "./components/CapabilitiesPanel.ts";
import { Composer } from "./components/Composer.ts";
import { ApprovalPrompt } from "./components/ApprovalPrompt.ts";
import { MessageItem } from "./components/MessageItem.ts";
import { ModelPicker } from "./components/ModelPicker.ts";
import { ToastStack } from "./components/ToastStack.ts";
import { DataTable } from "./components/blocks/DataTable.ts";
import { MediaGallery } from "./components/blocks/MediaGallery.ts";
import { UiBlockView } from "./components/blocks/UiBlockView.ts";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

interface Rendered<T> {
  fixture: ComponentFixture<T>;
  el: HTMLElement;
  /** Waits until Angular has rendered every pending change. */
  stable(): Promise<void>;
}

async function render<T>(
  component: Type<T>,
  { inputs = {}, providers = [], animations = false }: { inputs?: Record<string, unknown>; providers?: Provider[]; animations?: boolean } = {},
): Promise<Rendered<T>> {
  TestBed.configureTestingModule({ providers, animationsEnabled: animations, inferTagName: true });
  const fixture = TestBed.createComponent(component);
  for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
  // The store tells subscribers about changes in a microtask; let it run, so the render it schedules is awaited.
  const stable = async () => {
    await Promise.resolve();
    await fixture.whenStable();
  };
  await stable();
  return { fixture, el: fixture.nativeElement as HTMLElement, stable };
}

const button = (container: Element, text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

async function click(view: Rendered<unknown>, element: Element | null | undefined) {
  if (!element) throw new Error("Nothing to click");
  (element as HTMLElement).click();
  await view.stable();
}

/** Sets a field's value the way typing does, so the (input) handler runs. */
async function type(view: Rendered<unknown>, field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  await view.stable();
}

/** Waits for a condition the store reaches asynchronously, then for Angular to render it. */
async function until(view: Rendered<unknown>, condition: () => void) {
  await vi.waitFor(condition);
  await view.stable();
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

/** A fake server. Each run streams the next list of events. */
function testFetch(...runs: AgentEvent[][]) {
  const session: SessionDetail = { id: "s1", title: "Orders", createdAt: 1, updatedAt: 1, source: "chat", running: false, messages: [], allowedTools: [] };
  return vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace("http://test", "");
    const method = init?.method ?? "GET";
    if (path === "/config") return json(config);
    if (path === "/sessions" && method === "GET") return json([]);
    if (path === "/sessions" && method === "POST") return json(session, 201);
    if (path === "/sessions/s1/runs") return sse(runs.shift() ?? []);
    if (path === "/events") return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
    return json({ error: "nope" }, 404);
  }) as unknown as typeof globalThis.fetch;
}

function testStore(...runs: AgentEvent[][]) {
  const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch: testFetch(...runs) }), persist: false });
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
    const view = await render(AgentChat, { inputs: { store } });
    await store.init();
    await view.stable();
    expect(view.el.querySelector(".kl-models__name")?.textContent).toBe("Model");
    expect(view.el.querySelector(".kl-welcome__title")?.textContent).toBe("Test");

    await click(view, button(view.el, "Show orders"));
    await until(view, () => expect(store.state.running).toBe(false));
    expect(view.el.querySelector(".kl-chat__title")?.textContent).toBe("Orders");
    expect(view.el.querySelector(".kl-msg--user")?.textContent).toBe("Show orders");
    expect(view.el.querySelector(".kl-msg--assistant .kl-md")?.innerHTML).toContain("<strong>orders</strong>");
  });

  it("creates and owns a store from baseUrl", async () => {
    const view = await render(AgentChat, { inputs: { baseUrl: "http://test", fetch: testFetch() } });
    await until(view, () => expect(view.el.querySelector(".kl-welcome__title")?.textContent).toBe("Test"));
    const { store } = view.fixture.componentInstance;
    const dispose = vi.spyOn(store, "dispose");
    view.fixture.destroy();
    expect(dispose).toHaveBeenCalled();
  });

  it("sends its context with each run and clears it on destroy", async () => {
    const store = testStore([{ type: "run_end", runId: "r", status: "completed" }]);
    const run = vi.spyOn(store.client, "run");
    const view = await render(AgentChat, { inputs: { store, context: "Order #1042 is open" } });
    await store.init();
    await view.stable();

    await click(view, button(view.el, "Show orders"));
    await until(view, () => expect(store.state.running).toBe(false));
    expect(run.mock.calls[0]![1]).toMatchObject({ prompt: "Show orders", context: "Order #1042 is open" });

    const setContext = vi.spyOn(store, "setContext");
    view.fixture.destroy();
    expect(setContext).toHaveBeenCalledWith(undefined);
  });

  it("re-renders only the message that is streaming", async () => {
    const renders = vi.fn();
    @Component({ selector: "orders-result", template: `<span class="orders-result">{{ label() }}</span>` })
    class OrdersResult {
      readonly part = input<ToolPart>();
      label() {
        renders();
        return "2 orders";
      }
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
    const view = await render(AgentChat, { inputs: { store, renderers: { tools: { list_orders: OrdersResult } } } });
    await store.init();
    await store.send("Question 1");
    await view.stable();
    expect(view.el.querySelector(".orders-result")).not.toBeNull();
    const afterFirstRun = renders.mock.calls.length;

    await store.send("Question 2");
    await view.stable();
    expect(view.el.querySelectorAll(".kl-msg--assistant")[1]?.textContent).toContain("One two three four five");
    expect(renders.mock.calls.length).toBe(afterFirstRun);
  });

  it("projects header content and an empty state, also when its store comes from a binding", async () => {
    @Component({
      imports: [AgentChat, ModelPicker],
      template: `
        <kl-agent-chat [store]="store">
          <kl-model-picker klHeaderEnd placement="down" />
          <p klEmpty class="custom-empty">Nothing here yet</p>
        </kl-agent-chat>
      `,
    })
    class Host {
      readonly store = testStore();
    }
    const view = await render(Host);
    await view.fixture.componentInstance.store.init();
    await view.stable();
    expect(view.el.querySelector(".kl-chat__header .kl-models__name")?.textContent).toBe("Model");
    expect(view.el.querySelector(".kl-list .custom-empty")?.textContent).toBe("Nothing here yet");
    expect(view.el.querySelector(".kl-welcome")).toBeNull();
  });
});

describe("AgentWidget", () => {
  it("opens and closes the chat panel", async () => {
    const view = await render(AgentWidget, { inputs: { store: testStore(), label: "Ask Acme" } });
    const panel = view.el.querySelector<HTMLElement>(".kl-widget__panel")!;
    expect(panel.style.display).toBe("none");

    await click(view, button(view.el, "Ask Acme"));
    expect(panel.style.display).toBe("");
    expect(button(view.el, "Ask Acme")).toBeUndefined();

    await click(view, view.el.querySelector("[aria-label=Close]"));
    expect(panel.className).toContain("kl-widget-leave-active");
    panel.dispatchEvent(new Event("transitionend"));
    await view.stable();
    expect(panel.style.display).toBe("none");
    expect(panel.className).toBe("kl-widget__panel");
  });

  it("does not animate on mount, except toasts that appear", async () => {
    const store = testStore();
    const view = await render(AgentWidget, { inputs: { store, defaultOpen: true }, animations: true });
    expect(view.el.querySelector(".kl-widget__panel")!.className).toBe("kl-widget__panel");

    store.toast({ tone: "info", title: "Saved" }, 0);
    await view.stable();
    expect(view.el.querySelector(".kl-toast")!.className).toContain("kl-toast-enter-active");
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

    const view = await render(AgentWorkspace, { inputs: { store } });
    await store.init();
    await view.stable();
    expect(view.el.querySelector(".kl-workspace__app")?.textContent).toBe("Test");
    expect(view.el.querySelector(".kl-sessions__label")?.textContent).toBe("Today");

    await click(view, view.el.querySelector(".kl-session__open"));
    await until(view, () => expect(store.state.messages).toHaveLength(1));
    expect(view.el.querySelector(".kl-chat__title")?.textContent).toBe("Refund for Jane");
    expect(view.el.querySelector(".kl-session--active")).not.toBeNull();
    expect(view.el.querySelector(".kl-msg--user")?.textContent).toBe("Refund Jane's tent");

    await click(view, view.el.querySelector("[aria-label=Rename]"));
    const field = view.el.querySelector<HTMLInputElement>(".kl-session__rename")!;
    await type(view, field, "Jane's refund");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await until(view, () => expect(view.el.querySelector(".kl-session__title")?.textContent).toBe("Jane's refund"));
    expect(calls.filter((c) => c === "PATCH /sessions/s9")).toHaveLength(1);

    await click(view, button(view.el, "Tools"));
    expect(view.el.querySelector(".kl-caps__intro")?.textContent).toContain("Ada");
  });
});

describe("ToastStack", () => {
  it("keeps a dismissed toast in place until it has animated out", async () => {
    const store = testStore();
    const view = await render(ToastStack, { providers: [provideAgentStore(store)], animations: true });
    store.toast({ tone: "info", title: "First" }, 0);
    store.toast({ tone: "success", title: "Second" }, 0);
    await view.stable();
    const [first, second] = view.el.querySelectorAll<HTMLElement>(".kl-toast");

    store.dismissToast(store.state.toasts[0]!.id);
    await view.stable();
    expect([...view.el.querySelectorAll(".kl-toast")]).toEqual([first, second]);
    expect(first!.className).toContain("kl-toast-leave-active");
    expect(first!.className).not.toContain("kl-toast-enter");

    first!.dispatchEvent(new Event("transitionend"));
    await view.stable();
    expect([...view.el.querySelectorAll(".kl-toast")]).toEqual([second]);
  });
});

describe("provideKlymbak", () => {
  it("shares one store with every component and the app's own", async () => {
    @Component({
      selector: "unread-badge",
      template: `<span class="ready">{{ state().ready ? state().config?.user?.name : "loading" }}</span>`,
    })
    class Badge {
      readonly state = injectAgentState();
    }
    @Component({ imports: [AgentChat, Badge], template: `<unread-badge /><kl-agent-chat title="Support" />` })
    class Host {}
    const view = await render(Host, { providers: [provideKlymbak({ baseUrl: "http://test", fetch: testFetch() })] });
    await until(view, () => expect(view.el.querySelector(".ready")?.textContent).toBe("Ada"));
    expect(view.el.querySelector(".kl-welcome__title")?.textContent).toBe("Support");
    expect(view.el.querySelector("kl-agent-chat")!.hasAttribute("title")).toBe(false);
  });

  it("speaks its language, follows input changes and puts a component's messages on top", async () => {
    const store = testStore();
    const view = await render(AgentWorkspace, {
      providers: [provideKlymbak({ baseUrl: "http://test", fetch: testFetch(), locale: "de", messages: de })],
      inputs: { store, messages: { "chat.newChat": "Neues Gespräch" }, description: "Fragen Sie mich etwas." },
    });
    await store.init();
    await view.stable();
    expect(button(view.el, "Werkzeuge")).toBeDefined();
    expect(button(view.el, "Neues Gespräch")).toBeDefined();
    expect(view.el.querySelector(".kl-welcome__text")?.textContent).toBe("Fragen Sie mich etwas.");

    store.toast({ tone: "info", title: { id: "toast.taskStarted" } }, 0);
    await view.stable();
    expect(view.el.querySelector(".kl-toast strong")?.textContent).toBe("Aufgabe gestartet");

    view.fixture.componentRef.setInput("locale", "fr");
    view.fixture.componentRef.setInput("messages", fr);
    await view.stable();
    expect(button(view.el, "Outils")).toBeDefined();
    expect(button(view.el, "Nouvelle discussion")).toBeDefined();
    expect(view.el.querySelector(".kl-chat")?.getAttribute("aria-label")).toBe("Discussion avec l'agent");
    expect(view.el.querySelector(".kl-toast strong")?.textContent).toBe("Tâche lancée");
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
    const view = await render(DataTable, { inputs: { block }, providers: [{ provide: CHAT_ACTIONS, useValue: { sendPrompt, emitAction: () => undefined } }] });
    const totals = () => [...view.el.querySelectorAll("tbody tr")].map((tr) => tr.querySelectorAll("td")[1]!.textContent);
    expect(totals()).toEqual([formatValue(20, "currency"), formatValue(99.5, "currency")]);

    await click(view, view.el.querySelectorAll("th button")[1]);
    expect(totals()[0]).toBe(formatValue(99.5, "currency"));

    await click(view, view.el.querySelector("tbody tr .kl-table__row-actions button"));
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
    const view = await render(MediaGallery, { inputs: { block } });
    const tiles = () => view.el.querySelectorAll(".kl-media__item");
    const image = tiles()[0]!.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/uploads/cover.png");
    expect(image.alt).toBe("A red door");
    expect(tiles()[0]!.querySelector("a")?.target).toBe("_blank");
    expect(tiles()[0]!.querySelector(".kl-media__meta")?.textContent).toBe("PNG · 1024×768");
    expect(tiles()[1]!.querySelector("a")?.getAttribute("href")).toBe("/uploads/terms.pdf");
    expect(tiles()[1]!.querySelector(".kl-media__file")?.textContent).toBe("PDF");
    expect(tiles()[2]!.querySelector("a, img")).toBeNull();
    expect(view.el.querySelector(".kl-media__count")?.textContent).toBe("15 files");
    expect(tiles()).toHaveLength(12);
    await click(view, button(view.el, "Show 3 more"));
    expect(tiles()).toHaveLength(15);
  });

  it("empties the message box on send, even when Enter comes before Angular has rendered the typing", async () => {
    const view = await render(Composer);
    const sent = vi.fn();
    view.fixture.componentInstance.send.subscribe(sent);
    const field = view.el.querySelector("textarea")!;
    field.value = "Refund order 1042";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await view.stable();
    expect(sent).toHaveBeenCalledWith({ text: "Refund order 1042", attachments: [], references: { resources: [], templates: [], prompt: undefined, arguments: {} } });
    expect(field.value).toBe("");
  });

  it("mentions MCP resources with @, starts with a prompt from / and sends both", async () => {
    const resources = [
      { server: "carrier", uri: "carrier://zones", name: "Shipping zones" },
      { server: "carrier", uri: "carrier://policies/returns", name: "Return policy", description: "When returns are free" },
    ];
    const prompts = [{ server: "carrier", name: "delay_notice", title: "Delay notice", arguments: [{ name: "trackingNumber", required: true }] }];
    const view = await render(Composer, { inputs: { resources, prompts } });
    const sent = vi.fn();
    view.fixture.componentInstance.send.subscribe(sent);
    const box = view.el.querySelector("textarea")!;
    const options = () => [...view.el.querySelectorAll("[role=option] .kl-mention-menu__name")].map((o) => o.textContent);
    const key = async (name: string) => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
      await view.stable();
    };

    box.focus();
    await type(view, box, "/del");
    expect(options()).toEqual(["Delay notice"]);
    await key("Enter");
    expect(view.el.querySelector(".kl-ref--prompt")?.textContent?.trim()).toBe("/Delay notice");
    expect(box.value).toBe("");
    expect(view.el.querySelector<HTMLButtonElement>(".kl-composer__send")!.disabled).toBe(true);
    expect(document.activeElement).toBe(view.el.querySelector(".kl-composer__arg"));
    await type(view, view.el.querySelector<HTMLInputElement>(".kl-composer__arg")!, "AC123");

    box.focus();
    await type(view, box, "Mention @ret");
    expect(view.el.querySelector("[role=listbox]")?.getAttribute("aria-label")).toBe("Resources");
    expect(options()).toEqual(["Return policy"]);
    expect(box.getAttribute("aria-activedescendant")).toBe(view.el.querySelector("[role=option]")!.id);
    await key("Enter");
    expect(box.value).toBe("Mention @Return policy ");
    expect(view.el.querySelector("[role=listbox]")).toBeNull();

    await key("Enter");
    expect(sent).toHaveBeenCalledWith({
      text: "Mention @Return policy ",
      attachments: [],
      references: { resources: [resources[1]], templates: [], prompt: prompts[0], arguments: { trackingNumber: "AC123" } },
    });
    expect(view.el.querySelector(".kl-ref")).toBeNull();
  });

  it("mentions a resource template, asks for its values with the server's suggestions, and sends it", async () => {
    const resourceTemplates = [{ server: "carrier", uriTemplate: "carrier://shipments/{trackingNumber}{?events}", name: "Shipment", completes: true }];
    const complete = vi.fn(async ({ value }: { value: string }) => ["AC123", "AC124"].filter((v) => v.startsWith(value)));
    const view = await render(Composer, { inputs: { resourceTemplates, complete } });
    const sent = vi.fn();
    view.fixture.componentInstance.send.subscribe(sent);
    const box = view.el.querySelector("textarea")!;
    const key = async (name: string) => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
      await view.stable();
    };

    box.focus();
    await type(view, box, "Where is @sh");
    expect(view.el.querySelector("[role=option] .kl-mention-menu__detail")?.textContent).toBe("carrier://shipments/{trackingNumber}{?events}");
    await key("Enter");
    expect(box.value).toBe("Where is @Shipment ");
    const [tracking, events] = [...view.el.querySelectorAll<HTMLInputElement>(".kl-composer__arg")];
    expect([tracking!.placeholder, events!.placeholder]).toEqual(["trackingNumber", "events (optional)"]);
    expect(document.activeElement).toBe(tracking);
    expect(view.el.querySelector<HTMLButtonElement>(".kl-composer__send")!.disabled).toBe(true);

    await type(view, tracking!, "AC12");
    await vi.waitFor(() =>
      expect(complete).toHaveBeenLastCalledWith({ server: "carrier", template: resourceTemplates[0]!.uriTemplate, argument: "trackingNumber", value: "AC12", context: undefined }),
    );
    await vi.waitFor(async () => {
      await view.stable();
      const list = view.el.querySelector(`datalist[id="${tracking!.getAttribute("list")}"]`)!;
      expect([...list.querySelectorAll("option")].map((o) => o.value)).toEqual(["AC123", "AC124"]);
    });

    await type(view, tracking!, "AC123");
    await key("Enter");
    expect(sent.mock.calls[0]![0].references).toMatchObject({ templates: [{ template: resourceTemplates[0], values: { trackingNumber: "AC123" } }] });
  });

  it("shows the MCP servers' prompts and resources in the Tools panel, a few resources at a time", async () => {
    const resources = Array.from({ length: 12 }, (_, i) => ({ server: "docs", uri: `docs://page-${i}`, name: `Page ${i}` }));
    const withMcp: AgentConfigInfo = {
      ...config,
      resources,
      resourceTemplates: [{ server: "carrier", uriTemplate: "carrier://shipments/{trackingNumber}", name: "Shipment" }],
      prompts: [{ server: "carrier", name: "delay_notice", title: "Delay notice", arguments: [] }],
    };
    const store = { state: { config: withMcp }, subscribe: () => () => undefined, getVersion: () => 0 } as unknown as AgentStore;
    const view = await render(CapabilitiesPanel, { providers: [provideAgentStore(store)] });
    const section = (title: string) => [...view.el.querySelectorAll(".kl-caps__section")].find((s) => s.querySelector("h4")!.textContent!.trim().startsWith(title))!;
    expect(section("Prompts").querySelector(".kl-cap__name")?.textContent).toBe("/Delay notice");
    expect(section("Resources").querySelectorAll(".kl-cap")).toHaveLength(10);
    await click(view, section("Resources").querySelector(".kl-caps__more"));
    expect([...section("Resources").querySelectorAll(".kl-cap__uri")].at(-1)!.textContent).toBe("carrier://shipments/{trackingNumber}");
    expect(section("Resources").querySelector(".kl-caps__more")!.textContent!.trim()).toBe("Show fewer");
  });

  it("closes the mention menu on Escape and shows a message's resources and prompt as chips", async () => {
    const view = await render(Composer, { inputs: { resources: [{ server: "s", uri: "s://a", name: "Alpha" }] } });
    const sent = vi.fn();
    view.fixture.componentInstance.send.subscribe(sent);
    const box = view.el.querySelector("textarea")!;
    const key = async (name: string) => {
      box.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
      await view.stable();
    };
    box.focus();
    await type(view, box, "@a");
    expect(view.el.querySelector("[role=listbox]")).not.toBeNull();
    await key("Escape");
    expect(view.el.querySelector("[role=listbox]")).toBeNull();
    await key("Enter");
    expect(sent.mock.calls[0]![0].text).toBe("@a");

    TestBed.resetTestingModule();
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
    const item = await render(MessageItem, { inputs: { message } });
    expect([...item.el.querySelectorAll(".kl-ref__name")].map((name) => name.textContent)).toEqual(["/Delay notice", "Alpha"]);
    expect(item.el.querySelector(".kl-ref__detail")?.textContent).toBe("AC123");
    expect(item.el.querySelector(".kl-msg__text")?.textContent).toBe("Mention @Alpha");
  });

  it("asks for a reason before denying and sends the decision to the store", async () => {
    const decide = vi.fn(async () => undefined);
    const view = await render(ApprovalPrompt, {
      inputs: { approval: { id: "ap1", title: "Refund $80", status: "pending", risk: "high", rememberable: true } },
      providers: [provideAgentStore({ decide } as unknown as AgentStore)],
    });
    expect(view.el.textContent).toContain("Refund $80");
    await click(view, button(view.el, "Deny"));
    expect(decide).not.toHaveBeenCalled();
    await type(view, view.el.querySelector<HTMLInputElement>("input[type=text]")!, "Too much");
    await click(view, button(view.el, "Confirm deny"));
    expect(decide).toHaveBeenCalledWith("ap1", { approved: false, reason: "Too much", remember: false });
  });

  it("renders tool cards with their status and UI blocks", async () => {
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
    const view = await render(MessageItem, { inputs: { message } });
    expect(view.el.querySelector(".kl-tool__name")?.textContent).toBe("List orders");
    expect(view.el.querySelector(".kl-tool .kl-pill")?.textContent).toBe("Done");
    expect(view.el.querySelector(".kl-stat__value")?.textContent).toBe("2");
    expect(view.el.querySelector(".kl-md")?.innerHTML).toContain("Here you go");
  });

  it("renders custom blocks with the props their component takes", async () => {
    @Component({ selector: "order-badge", template: `<b class="order-badge">#{{ id() }}</b>` })
    class OrderBadge {
      readonly id = input<number>();
    }
    @Component({ imports: [UiBlockView], template: `<kl-ui-block-view [block]="block" />` })
    class Host {
      readonly block = { type: "custom" as const, component: "order", props: { id: 1042, unknown: "ignored" } };
    }
    const error = vi.spyOn(console, "error");
    const view = await render(Host, { providers: [provideKlymbak({ baseUrl: "http://test", fetch: testFetch(), autoInit: false, renderers: { blocks: { order: OrderBadge } } })] });
    expect(view.el.querySelector(".order-badge")?.textContent).toBe("#1042");
    expect(error).not.toHaveBeenCalled();
  });

  it("escapes HTML in model output", async () => {
    const message: ChatMessage = {
      id: "a",
      role: "assistant",
      createdAt: 1,
      status: "done",
      parts: [{ type: "text", text: '<img src=x onerror="alert(1)"> **bold**' }],
    };
    const view = await render(MessageItem, { inputs: { message } });
    const html = view.el.querySelector(".kl-md")!.innerHTML;
    expect(html).not.toContain("<img");
    expect(html).toContain("<strong>bold</strong>");
  });
});
