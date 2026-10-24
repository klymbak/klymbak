// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { h, isReactive, nextTick, watch } from "vue";
import type { AgentConfigInfo, ChatMessage, MediaBlock, TableBlock } from "@klymbak/protocol";
import { createAgentClient, formatValue, type Text } from "@klymbak/client";
import de from "@klymbak/client/locales/de";
import fr from "@klymbak/client/locales/fr";
import { Klymbak, provideAgentStore, provideChatActions } from "./context";
import { createAgentStore, type AgentStore } from "./store";
import AgentWorkspace from "./components/AgentWorkspace.vue";
import ApprovalPrompt from "./components/ApprovalPrompt.vue";
import CapabilitiesPanel from "./components/CapabilitiesPanel.vue";
import Composer from "./components/Composer.vue";
import DataTable from "./components/blocks/DataTable.vue";
import MediaGallery from "./components/blocks/MediaGallery.vue";
import MessageItem from "./components/MessageItem.vue";

const config: AgentConfigInfo = {
  app: { name: "Test" },
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

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

// The store's behaviour is tested in @klymbak/client; this covers the Vue wrapper.
describe("agent store", () => {
  it("makes the shared store reactive and derives computed views", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/config")) return json(config);
      if (url.endsWith("/events")) return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
      return json([]);
    }) as unknown as typeof globalThis.fetch;
    const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch }), persist: false });
    expect(isReactive(store.state)).toBe(true);
    const titles: Text[][] = [];
    watch(() => store.state.toasts.map((t) => t.title), (value) => titles.push(value), { flush: "sync" });

    await store.init();
    expect(store.models.value.map((m) => m.id)).toEqual(["m"]);
    expect(store.currentModel.value?.name).toBe("Model");
    expect(store.unreadCount.value).toBe(0);

    store.toast({ tone: "info", title: "Saved" }, 0);
    expect(titles).toEqual([["Saved"]]);
    store.dispose();
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
    const wrapper = mount({
      setup() {
        provideChatActions({ sendPrompt, emitAction: () => undefined });
        return () => h(DataTable, { block });
      },
    });
    const totals = () => wrapper.findAll("tbody tr").map((tr) => tr.findAll("td")[1]!.text());
    expect(totals()).toEqual(["$20.00", "$99.50"].map((v) => formatValue(Number(v.replace(/[$,]/g, "")), "currency")));

    await wrapper.findAll("th button")[1]!.trigger("click");
    expect(totals()[0]).toBe(formatValue(99.5, "currency"));

    await wrapper.find("tbody tr .kl-table__row-actions button").trigger("click");
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
    const wrapper = mount(MediaGallery, { props: { block } });
    const tiles = () => wrapper.findAll(".kl-media__item");
    const image = tiles()[0]!.find("img");
    expect(image.attributes("src")).toBe("/uploads/cover.png");
    expect(image.attributes("alt")).toBe("A red door");
    expect(tiles()[0]!.find("a").attributes("target")).toBe("_blank");
    expect(tiles()[0]!.find(".kl-media__meta").text()).toBe("PNG · 1024×768");
    expect(tiles()[1]!.find("a").attributes("href")).toBe("/uploads/terms.pdf");
    expect(tiles()[1]!.find(".kl-media__file").text()).toBe("PDF");
    expect(tiles()[2]!.find("a, img").exists()).toBe(false);
    expect(wrapper.find(".kl-media__count").text()).toBe("15 files");
    expect(tiles()).toHaveLength(12);
    await wrapper.findAll("button").find((b) => b.text().includes("Show 3 more"))!.trigger("click");
    expect(tiles()).toHaveLength(15);
  });

  it("asks for a reason before denying and sends the decision to the store", async () => {
    const decide = vi.fn(async () => undefined);
    const wrapper = mount({
      setup() {
        provideAgentStore({ decide } as unknown as AgentStore);
        return () => h(ApprovalPrompt, { approval: { id: "ap1", title: "Refund $80", status: "pending", risk: "high", rememberable: true } });
      },
    });
    expect(wrapper.text()).toContain("Refund $80");
    const deny = wrapper.findAll("button").find((b) => b.text().includes("Deny"))!;
    await deny.trigger("click");
    expect(decide).not.toHaveBeenCalled();
    await wrapper.find("input[type=text]").setValue("Too much");
    await wrapper.findAll("button").find((b) => b.text().includes("Confirm deny"))!.trigger("click");
    await flushPromises();
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
    const wrapper = mount(MessageItem, { props: { message } });
    await nextTick();
    expect(wrapper.find(".kl-tool__name").text()).toBe("List orders");
    expect(wrapper.find(".kl-tool .kl-pill").text()).toBe("Done");
    expect(wrapper.find(".kl-stat__value").text()).toBe("2");
    expect(wrapper.find(".kl-md").html()).toContain("Here you go");
  });

  it("speaks the plugin's language, follows prop changes and puts a component's messages on top", async () => {
    const fetch = vi.fn(async (url: string) => {
      if (url.endsWith("/config")) return json(config);
      if (url.endsWith("/events")) return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
      return json([]);
    }) as unknown as typeof globalThis.fetch;
    const wrapper = mount(AgentWorkspace, {
      props: { messages: { "chat.newChat": "Neues Gespräch" }, description: "Fragen Sie mich etwas." },
      global: { plugins: [[Klymbak, { baseUrl: "http://test", fetch, locale: "de", messages: de }]] },
    });
    await flushPromises();
    const button = (text: string) => wrapper.findAll("button").find((b) => b.text().includes(text));
    expect(button("Werkzeuge")).toBeDefined();
    expect(button("Neues Gespräch")).toBeDefined();
    expect(wrapper.find(".kl-welcome__text").text()).toBe("Fragen Sie mich etwas.");

    await wrapper.setProps({ locale: "fr", messages: fr });
    expect(button("Outils")).toBeDefined();
    expect(button("Nouvelle discussion")).toBeDefined();
    expect(wrapper.find(".kl-chat").attributes("aria-label")).toBe("Discussion avec l'agent");
    wrapper.unmount();
  });

  it("mentions MCP resources with @, starts with a prompt from / and sends both", async () => {
    const resources = [
      { server: "carrier", uri: "carrier://zones", name: "Shipping zones" },
      { server: "carrier", uri: "carrier://policies/returns", name: "Return policy", description: "When returns are free" },
    ];
    const prompts = [{ server: "carrier", name: "delay_notice", title: "Delay notice", arguments: [{ name: "trackingNumber", required: true }] }];
    const wrapper = mount(Composer, { props: { resources, prompts }, attachTo: document.body });
    const box = wrapper.find("textarea");
    await box.trigger("focus");

    await box.setValue("/del");
    expect(wrapper.findAll("[role=option]").map((o) => o.find(".kl-mention-menu__name").text())).toEqual(["Delay notice"]);
    await box.trigger("keydown", { key: "Enter" });
    await nextTick();
    expect(wrapper.find(".kl-ref--prompt").text()).toBe("/Delay notice");
    expect((box.element as HTMLTextAreaElement).value).toBe("");
    expect(wrapper.find(".kl-composer__send").attributes("disabled")).toBeDefined();
    await wrapper.find(".kl-composer__arg").setValue("AC123");

    await box.trigger("focus");
    await box.setValue("Mention @ret");
    expect(wrapper.find("[role=listbox]").attributes("aria-label")).toBe("Resources");
    expect(wrapper.findAll("[role=option]").map((o) => o.find(".kl-mention-menu__name").text())).toEqual(["Return policy"]);
    expect(box.attributes("aria-activedescendant")).toBe(wrapper.find("[role=option]").attributes("id"));
    await box.trigger("keydown", { key: "Enter" });
    await nextTick();
    expect((box.element as HTMLTextAreaElement).value).toBe("Mention @Return policy ");
    expect(wrapper.find("[role=listbox]").exists()).toBe(false);

    await box.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")?.[0]).toEqual([
      "Mention @Return policy ",
      [],
      { resources: [resources[1]], templates: [], prompt: prompts[0], arguments: { trackingNumber: "AC123" } },
    ]);
    expect(wrapper.find(".kl-ref").exists()).toBe(false);
    wrapper.unmount();
  });

  it("mentions a resource template, asks for its values with the server's suggestions, and sends it", async () => {
    vi.useFakeTimers();
    const resourceTemplates = [{ server: "carrier", uriTemplate: "carrier://shipments/{trackingNumber}{?events}", name: "Shipment", completes: true }];
    const complete = vi.fn(async ({ value }: { value: string }) => ["AC123", "AC124"].filter((v) => v.startsWith(value)));
    const wrapper = mount(Composer, { props: { resourceTemplates, complete }, attachTo: document.body });
    const box = wrapper.find("textarea");
    await box.trigger("focus");
    await box.setValue("Where is @sh");
    expect(wrapper.find("[role=option] .kl-mention-menu__detail").text()).toBe("carrier://shipments/{trackingNumber}{?events}");
    await box.trigger("keydown", { key: "Enter" });
    await nextTick();
    expect((box.element as HTMLTextAreaElement).value).toBe("Where is @Shipment ");
    const [tracking, events] = wrapper.findAll(".kl-composer__arg");
    expect([tracking!.attributes("placeholder"), events!.attributes("placeholder")]).toEqual(["trackingNumber", "events (optional)"]);
    expect(document.activeElement).toBe(tracking!.element);
    expect(wrapper.find(".kl-composer__send").attributes("disabled")).toBeDefined();

    await tracking!.setValue("AC12");
    await vi.advanceTimersByTimeAsync(200);
    expect(complete).toHaveBeenLastCalledWith({
      server: "carrier",
      template: resourceTemplates[0]!.uriTemplate,
      argument: "trackingNumber",
      value: "AC12",
      context: undefined,
    });
    const list = wrapper.find(`datalist#${tracking!.attributes("list")}`);
    expect(list.findAll("option").map((o) => o.attributes("value"))).toEqual(["AC123", "AC124"]);

    await tracking!.setValue("AC123");
    await box.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")?.[0]?.[2]).toMatchObject({ templates: [{ template: resourceTemplates[0], values: { trackingNumber: "AC123" } }] });
    vi.useRealTimers();
    wrapper.unmount();
  });

  it("shows the MCP servers' prompts and resources in the Tools panel, a few resources at a time", async () => {
    const resources = Array.from({ length: 12 }, (_, i) => ({ server: "docs", uri: `docs://page-${i}`, name: `Page ${i}` }));
    const withMcp: AgentConfigInfo = {
      ...config,
      resources,
      resourceTemplates: [{ server: "carrier", uriTemplate: "carrier://shipments/{trackingNumber}", name: "Shipment" }],
      prompts: [{ server: "carrier", name: "delay_notice", title: "Delay notice", description: "Draft an email about a late parcel", arguments: [] }],
    };
    const wrapper = mount({
      setup() {
        provideAgentStore({ state: { config: withMcp } } as unknown as AgentStore);
        return () => h(CapabilitiesPanel);
      },
    });
    const section = (title: string) => wrapper.findAll(".kl-caps__section").find((s) => s.find("h4").text().startsWith(title))!;
    expect(section("Prompts").find(".kl-cap__name").text()).toBe("/Delay notice");
    expect(section("Prompts").find(".kl-caps__hint").text()).toBe("Type / at the start of a message to use one.");
    expect(section("Resources").find("h4").text()).toBe("Resources 13");
    expect(section("Resources").findAll(".kl-cap")).toHaveLength(10);
    await section("Resources").find(".kl-caps__more").trigger("click");
    expect(section("Resources").findAll(".kl-cap__uri").at(-1)!.text()).toBe("carrier://shipments/{trackingNumber}");
    expect(section("Resources").find(".kl-caps__more").text()).toBe("Show fewer");
  });

  it("closes the mention menu on Escape and shows a message's resources and prompt as chips", async () => {
    const wrapper = mount(Composer, { props: { resources: [{ server: "s", uri: "s://a", name: "Alpha" }] } });
    const box = wrapper.find("textarea");
    await box.trigger("focus");
    await box.setValue("@a");
    expect(wrapper.find("[role=listbox]").exists()).toBe(true);
    await box.trigger("keydown", { key: "Escape" });
    expect(wrapper.find("[role=listbox]").exists()).toBe(false);
    await box.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("send")?.[0]?.[0]).toBe("@a");

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
    const item = mount(MessageItem, { props: { message } });
    expect(item.findAll(".kl-ref__name").map((name) => name.text())).toEqual(["/Delay notice", "Alpha"]);
    expect(item.find(".kl-ref__detail").text()).toBe("AC123");
    expect(item.find(".kl-msg__text").text()).toBe("Mention @Alpha");
  });

  it("escapes HTML in model output", () => {
    const message: ChatMessage = {
      id: "a",
      role: "assistant",
      createdAt: 1,
      status: "done",
      parts: [{ type: "text", text: '<img src=x onerror="alert(1)"> **bold**' }],
    };
    const html = mount(MessageItem, { props: { message } }).find(".kl-md").html();
    expect(html).not.toContain("<img");
    expect(html).toContain("<strong>bold</strong>");
  });
});
