// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { h, isReactive, nextTick, watch } from "vue";
import type { AgentConfigInfo, ChatMessage, MediaBlock, TableBlock } from "@klymbak/protocol";
import { createAgentClient, formatValue } from "@klymbak/client";
import { provideAgentStore, provideChatActions } from "./context";
import { createAgentStore, type AgentStore } from "./store";
import ApprovalPrompt from "./components/ApprovalPrompt.vue";
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
    const titles: string[][] = [];
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
