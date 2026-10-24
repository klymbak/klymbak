import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createTranslator, preferredLocale } from "./i18n.ts";
import { en } from "./messages.ts";

/** The names of a message's values: {name}, {count, plural, …}. */
export function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1]!))].sort();
}

describe("createTranslator", () => {
  const t = createTranslator(
    { rows: "{count, plural, one {# row} other {# rows}}", hello: "Hello, {name}" },
    { de: { rows: "{count, plural, one {# Zeile} other {# Zeilen}}" }, "pt-BR": { hello: "Olá, {name}" } },
  );

  it("finds the closest language and falls back to English per message", () => {
    expect(t("de-AT", "rows", { count: 1 })).toBe("1 Zeile");
    expect(t("de", "rows", { count: 1200 })).toBe("1.200 Zeilen");
    expect(t("de", "hello", { name: "Ada" })).toBe("Hello, Ada");
    expect(t("pt", "hello", { name: "Ada" })).toBe("Olá, Ada");
    expect(t("sv", "rows", { count: 2 })).toBe("2 rows");
    expect(t(undefined, "rows", { count: 1 })).toBe("1 row");
    expect(t.locales).toEqual(["en", "de", "pt-BR"]);
  });

  it("uses English plural rules for an English fallback, and the person's number format", () => {
    // Polish has no "rows" message: the English one needs English plurals, with Polish digits grouping.
    const pl = createTranslator({ rows: "{count, plural, one {# row} other {# rows}}" }, { pl: {} });
    expect(pl("pl", "rows", { count: 1 })).toBe("1 row");
    expect(pl("pl", "rows", { count: 12_345 })).toBe("12\u00a0345 rows");
  });
});

describe("preferredLocale", () => {
  it("picks the most preferred valid language", () => {
    expect(preferredLocale("de-AT,de;q=0.9,en;q=0.8")).toBe("de-AT");
    expect(preferredLocale("en;q=0.5, uk")).toBe("uk");
    expect(preferredLocale("*, fr;q=0.1")).toBe("fr");
    expect(preferredLocale("not a tag!, ja")).toBe("ja");
    expect(preferredLocale("")).toBeUndefined();
    expect(preferredLocale(undefined)).toBeUndefined();
  });
});

describe("the server's catalogs", () => {
  const files = readdirSync(new URL("./locales", import.meta.url)).filter((file) => file.endsWith(".ts"));

  it.each(files)("%s has every message, with the same values as English", async (file) => {
    const catalog = (await import(`./locales/${file}`)).default as Record<string, string>;
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort());
    for (const [id, message] of Object.entries(en)) {
      expect(placeholders(catalog[id]!), `${file}: ${id}`).toEqual(placeholders(message));
    }
  });
});
