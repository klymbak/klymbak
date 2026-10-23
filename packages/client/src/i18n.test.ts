import { describe, expect, it, vi } from "vitest";
import type { AgentConfigInfo } from "@klymbak/protocol";
import { createAgentClient } from "./client.ts";
import { createI18n, formatMessage, loadMessages, locales, matchLocale } from "./i18n.ts";
import de from "./locales/de.ts";
import { en } from "./messages.ts";
import { createAgentStore } from "./store.ts";

describe("formatMessage", () => {
  it("fills in values and picks plural forms by the locale's rules", () => {
    expect(formatMessage("Remove {name}", { name: "a.png" })).toBe("Remove a.png");
    const rows = "{count, plural, one {# row} other {# rows}}";
    expect(formatMessage(rows, { count: 1 })).toBe("1 row");
    expect(formatMessage(rows, { count: 1234 }, "en")).toBe("1,234 rows");
    const files = "{count, plural, one {# plik} few {# pliki} many {# plików} other {# pliku}}";
    expect([1, 2, 5, 22, 25, 1.5].map((count) => formatMessage(files, { count }, "pl"))).toEqual([
      "1 plik",
      "2 pliki",
      "5 plików",
      "22 pliki",
      "25 plików",
      "1,5 pliku",
    ]);
    expect(formatMessage("{n, plural, =0 {none} one {one} other {#}}", { n: 0 })).toBe("none");
  });

  it("selects, nests and quotes like ICU", () => {
    const kind = "{kind, select, file {a file} other {something}}";
    expect(formatMessage(kind, { kind: "file" })).toBe("a file");
    expect(formatMessage(kind, { kind: "folder" })).toBe("something");
    expect(formatMessage("{count, plural, one {{tokens} token} other {{tokens} tokens}}", { count: 12_500, tokens: "12.5k" })).toBe("12.5k tokens");
    expect(formatMessage("Don't write '{braces}' or ''quotes''")).toBe("Don't write {braces} or 'quotes'");
  });

  it("shows a malformed message as written, and a missing value as its name", () => {
    expect(formatMessage("Show {count more", { count: 2 })).toBe("Show {count more");
    expect(formatMessage("{n, plural, one {x}}", { n: 1 })).toBe("{n, plural, one {x}}");
    expect(formatMessage("Hello {name}")).toBe("Hello {name}");
  });
});

describe("createI18n", () => {
  it("falls back to English for messages it isn't given", () => {
    const i18n = createI18n({ locale: "de", messages: { "chat.newChat": "Neuer Chat" } });
    expect(i18n.t("chat.newChat")).toBe("Neuer Chat");
    expect(i18n.t("chat.retry")).toBe("Try again");
  });

  it("puts numbers, dates, durations and schedules into its language", () => {
    const i18n = createI18n({ locale: "de", messages: de });
    expect(i18n.t("table.rows", { count: 1234 })).toBe("1.234 Zeilen");
    expect(i18n.formatValue(1234.5, "number")).toBe("1.234,5");
    expect(i18n.formatValue(true)).toBe("Ja");
    expect(i18n.duration(1500)).toBe("1,5 s");
    expect(i18n.describeCron("0 8 * * 1-5")).toBe("Werktags um 08:00");
    expect(i18n.describeCron("0 */1 * * *")).toBe("Jede Stunde");
    expect(i18n.timeAgo(Date.now() - 5_000)).toBe("gerade eben");
    expect(i18n.timeAgo(Date.now() - 3 * 3_600_000)).toBe("vor 3 Stunden");
  });

  it("splits a message into parts so a UI can style the values", () => {
    const i18n = createI18n();
    expect(i18n.parts("tool.mcpFrom", { server: "strapi" })).toEqual([{ text: "MCP tool from " }, { text: "strapi", arg: "server" }]);
    expect(i18n.text("As is")).toBe("As is");
    expect(i18n.text({ id: "toast.scheduleReady", values: { name: "Digest" } })).toBe("Digest is ready");
  });

  it("reads underscores as hyphens and drops a tag Intl rejects", () => {
    expect(createI18n({ locale: "pt_BR" }).locale).toBe("pt-BR");
    expect(createI18n({ locale: "not a locale" }).locale).toBeUndefined();
  });
});

describe("catalogs", () => {
  const values = {
    name: "Ada",
    tokens: "1.2k",
    shown: 10,
    total: 25,
    server: "strapi",
    level: "high",
    reason: "No",
    when: "in 2 hours",
    time: "08:00",
    day: "1",
    ms: "350",
    s: "1.5",
    title: "Sales",
    roles: "admin",
    asksFirst: "asks first",
  };

  it.each(["en", ...locales])("%s has every message, and each one formats", async (locale) => {
    const messages = locale === "en" ? en : await loadMessages(locale);
    expect(Object.keys(messages ?? {}).sort()).toEqual(Object.keys(en).sort());
    for (const [id, template] of Object.entries(messages ?? {})) {
      for (const count of [0, 1, 2, 5, 21, 1.5]) {
        // A brace left over is a malformed message or an argument name the code never passes.
        expect(formatMessage(template, { ...values, count }, locale), `${locale} ${id}`).not.toMatch(/[{}]/);
      }
    }
  });

  it("matches a language tag to the closest catalog", () => {
    expect(matchLocale("de-AT")).toBe("de");
    expect(matchLocale("pt")).toBe("pt-BR");
    expect(matchLocale("pt_BR")).toBe("pt-BR");
    expect(matchLocale("zh-CN")).toBe("zh-Hans");
    expect(matchLocale("zh-TW")).toBeUndefined();
    expect(matchLocale("en-GB")).toBeUndefined();
    expect(matchLocale("xx")).toBeUndefined();
  });
});

describe("store messages", () => {
  const config: AgentConfigInfo = {
    app: { name: "Test" },
    user: { id: "u1", name: "Ada", roles: ["admin"] },
    models: [],
    tools: [],
    subagents: [],
    skills: [],
    mcpServers: [],
    features: { schedules: false, steering: true, runtimeMcp: false, attachments: false },
  };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

  it("are message ids, put into words by the UI that shows them", async () => {
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/config")) return json(config);
      if (url.endsWith("/events")) return new Response(new ReadableStream(), { headers: { "content-type": "text/event-stream" } });
      if (init?.method === "DELETE") return json({ error: "Not yours" }, 403);
      return json([]);
    }) as unknown as typeof globalThis.fetch;
    const store = createAgentStore({ client: createAgentClient({ baseUrl: "http://test", fetch }), persist: false });
    await store.init();
    await store.deleteSession("s1");

    const [toast] = store.state.toasts;
    expect(toast?.title).toEqual({ id: "error.deleteSession" });
    expect(createI18n({ locale: "de", messages: de }).text(toast!.title)).toBe("Die Unterhaltung konnte nicht gelöscht werden");
    expect(createI18n().text(toast!.title)).toBe("Couldn't delete the conversation");
    store.dispose();
  });
});
