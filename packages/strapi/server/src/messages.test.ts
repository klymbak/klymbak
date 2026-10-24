import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { en, t } from "./messages.ts";

/** The names of a message's values: {name}, {count, plural, …}. */
function placeholders(message: string): string[] {
  return [...new Set([...message.matchAll(/\{(\w+)\s*[,}]/g)].map((match) => match[1]!))].sort();
}

describe("the plugin's catalogs", () => {
  const files = readdirSync(new URL("./locales", import.meta.url)).filter((file) => file.endsWith(".ts"));

  it("cover the admin's languages", () => {
    const admin = readdirSync(new URL("../../admin/src/translations", import.meta.url)).map((file) => file.replace(/\.json$/, ""));
    expect([...t.locales].sort()).toEqual(admin.sort());
  });

  it.each(files)("%s has every message, with the same values as English", async (file) => {
    const catalog = (await import(`./locales/${file}`)).default as Record<string, string>;
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(en).sort());
    for (const [id, message] of Object.entries(en)) {
      expect(placeholders(catalog[id]!), `${file}: ${id}`).toEqual(placeholders(message));
    }
  });

  it("writes plurals by each language's rules", () => {
    expect(t("pl", "value.items", { count: 3 })).toBe("3 elementy");
    expect(t("pl", "value.items", { count: 5 })).toBe("5 elementów");
    expect(t("uk", "value.items", { count: 21 })).toBe("21 елемент");
  });
});
