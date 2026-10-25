import { describe, expect, it, vi } from "vitest";
import type { McpPromptInfo, McpResourceInfo } from "@klymbak/protocol";
import {
  createSuggester,
  findMention,
  insertMention,
  matchPrompts,
  matchResources,
  mentionKey,
  mentionOptions,
  promptFields,
  promptReady,
  referenceParts,
  referenceView,
  removeMention,
  templateFields,
  templateReady,
  templateValues,
} from "./mentions.ts";

const resources: McpResourceInfo[] = [
  { server: "carrier", uri: "carrier://zones", name: "Shipping zones", description: "Which countries are in which zone" },
  { server: "carrier", uri: "carrier://policies/returns", name: "Return policy" },
  { server: "docs", uri: "docs://refunds", name: "Refunds", description: "How a return is refunded" },
];

const prompts: McpPromptInfo[] = [
  { server: "carrier", name: "weekly_report", title: "Weekly report", arguments: [] },
  { server: "carrier", name: "delay_notice", title: "Delay notice", arguments: [{ name: "trackingNumber", required: true }, { name: "tone" }] },
];

describe("findMention", () => {
  it("finds an @ at the start or after a space, and a / that starts the message", () => {
    expect(findMention("@ret", 4)).toEqual({ kind: "resource", query: "ret", start: 0, end: 4 });
    expect(findMention("Read @ret and", 9)).toEqual({ kind: "resource", query: "ret", start: 5, end: 9 });
    expect(findMention("Read @", 6)).toEqual({ kind: "resource", query: "", start: 5, end: 6 });
    expect(findMention("/del", 4)).toEqual({ kind: "prompt", query: "del", start: 0, end: 4 });
  });

  it("ignores e-mail addresses, finished mentions and slashes inside the text", () => {
    expect(findMention("Mail ada@example.com", 20)).toBeUndefined();
    expect(findMention("Read @ret now", 13)).toBeUndefined();
    expect(findMention("Use /api/orders", 15)).toBeUndefined();
    expect(findMention("/delay notice", 13)).toBeUndefined();
  });
});

describe("matching", () => {
  it("puts names that start with the query first, then names with it, then the rest", () => {
    expect(matchResources(resources, "re").map((r) => r.name)).toEqual(["Return policy", "Refunds", "Shipping zones"]);
    expect(matchResources(resources, "zone").map((r) => r.name)).toEqual(["Shipping zones"]);
    expect(matchResources(resources, "docs").map((r) => r.name)).toEqual(["Refunds"]);
    expect(matchResources(resources, "").map((r) => r.name)).toEqual(["Shipping zones", "Return policy", "Refunds"]);
    expect(matchResources(resources, "", 1)).toHaveLength(1);
  });

  it("matches prompts by name and title", () => {
    expect(matchPrompts(prompts, "delay").map((p) => p.name)).toEqual(["delay_notice"]);
    expect(matchPrompts(prompts, "notice").map((p) => p.name)).toEqual(["delay_notice"]);
    expect(matchPrompts(prompts, "x")).toEqual([]);
  });

  it("offers resources not mentioned yet, and prompts until one is chosen", () => {
    const at = findMention("@r", 2);
    expect(mentionOptions(at, { resources }, { resources: [resources[1]!] }).map((o) => [o.name, o.detail])).toEqual([
      ["Refunds", "How a return is refunded"],
      ["Shipping zones", "Which countries are in which zone"],
    ]);
    const slash = findMention("/", 1);
    expect(mentionOptions(slash, { prompts }, { resources: [] }).map((o) => [o.name, o.detail])).toEqual([
      ["Weekly report", "/weekly_report"],
      ["Delay notice", "/delay_notice"],
    ]);
    expect(mentionOptions(slash, { prompts }, { resources: [], prompt: prompts[0] })).toEqual([]);
    expect(mentionOptions(undefined, { resources, prompts }, { resources: [] })).toEqual([]);
  });
});

describe("editing", () => {
  it("puts the chosen name in place of the mention", () => {
    expect(insertMention("Read @ret now", { kind: "resource", query: "ret", start: 5, end: 9 }, "Return policy")).toEqual({
      text: "Read @Return policy now",
      caret: 20,
    });
    expect(removeMention("/del rest", { kind: "prompt", query: "del", start: 0, end: 4 })).toEqual({ text: "rest", caret: 0 });
  });

  it("moves through the menu, chooses and closes", () => {
    expect([mentionKey("ArrowDown", 2, 3), mentionKey("ArrowUp", 0, 3)]).toEqual([0, 2]);
    expect([mentionKey("Enter", 0, 3), mentionKey("Tab", 0, 3), mentionKey("Escape", 0, 3), mentionKey("a", 0, 3)]).toEqual([
      "choose",
      "choose",
      "close",
      undefined,
    ]);
  });

  it("shows a message's resources and prompt by name, with the prompt's values", () => {
    const parts = referenceParts([
      { type: "prompt", server: "carrier", name: "delay_notice", title: "Delay notice", arguments: { trackingNumber: "AC123", tone: "formal" } },
      { type: "text", text: "Mention @Return policy" },
      { type: "resource", server: "carrier", uri: "carrier://policies/returns", name: "Return policy" },
    ]);
    expect(parts.map(referenceView)).toEqual([
      { icon: "chat", name: "/Delay notice", detail: "AC123 · formal", title: "carrier: delay_notice\ntrackingNumber: AC123\ntone: formal" },
      { icon: "file", name: "Return policy", title: "carrier: carrier://policies/returns" },
    ]);
  });

  it("offers resource templates with the resources, as often as they're wanted", () => {
    const shipment = { server: "carrier", uriTemplate: "carrier://shipments/{trackingNumber}{?events}", name: "Shipment", completes: true };
    const options = mentionOptions(findMention("@ship", 5), { resources, resourceTemplates: [shipment] }, { resources: [] });
    expect(options.map((o) => [o.name, o.detail, Boolean(o.template)])).toEqual([
      ["Shipping zones", "Which countries are in which zone", false],
      ["Shipment", "carrier://shipments/{trackingNumber}{?events}", true],
    ]);

    const fields = templateFields(shipment);
    expect(fields.fields).toEqual([
      { name: "trackingNumber", label: "trackingNumber", required: true },
      { name: "events", label: "events", required: false },
    ]);
    expect(fields.request("events", { trackingNumber: "AC123", events: "a" })).toEqual({
      server: "carrier",
      template: shipment.uriTemplate,
      argument: "events",
      value: "a",
      context: { trackingNumber: "AC123" },
    });
    expect([templateReady(shipment, { events: "all" }), templateReady(shipment, { trackingNumber: "AC123" })]).toEqual([false, true]);
    expect(templateValues(shipment, { events: " ", other: "x", trackingNumber: " AC123 " })).toEqual({ trackingNumber: "AC123" });
    expect(promptFields(prompts[1]!)).toMatchObject({ label: "/Delay notice", completes: false, fields: [{ name: "trackingNumber", required: true }, { name: "tone", required: false }] });
  });

  it("asks for suggestions after a pause, and shows only the latest answer for each field", async () => {
    vi.useFakeTimers();
    const answers: ((values: string[]) => void)[] = [];
    const complete = vi.fn(() => new Promise<string[]>((resolve) => answers.push(resolve)));
    const shown: [string, string[]][] = [];
    const suggester = createSuggester(complete, (key, values) => shown.push([key, values]));
    const request = (value: string) => ({ server: "s", prompt: "p", argument: "a", value });

    suggester.ask("a", request("A"));
    suggester.ask("a", request("AC"));
    vi.advanceTimersByTime(150);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenLastCalledWith(request("AC"));
    suggester.ask("a", request("AC1"));
    vi.advanceTimersByTime(150);
    answers[1]!(["AC123"]);
    answers[0]!(["AC9"]);
    await vi.runAllTimersAsync();
    expect(shown).toEqual([["a", ["AC123"]]]);
    suggester.dispose();
    vi.useRealTimers();
  });

  it("knows when a prompt has every value it requires", () => {
    expect(promptReady(prompts[1]!, { trackingNumber: " " })).toBe(false);
    expect(promptReady(prompts[1]!, { trackingNumber: "AC123" })).toBe(true);
    expect(promptReady(prompts[0]!, {})).toBe(true);
  });
});
