import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatMessage, matchLocale } from "@klymbak/react";

const folder = new URL("./translations/", import.meta.url);
const read = (file: string) => JSON.parse(readFileSync(new URL(file, folder), "utf8")) as Record<string, string>;
const en = read("en.json");
const files = readdirSync(folder).filter((file) => file.endsWith(".json") && file !== "en.json");

describe("admin translations", () => {
  it.each(files)("%s has every message, and each one formats", (file) => {
    const messages = read(file);
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
    for (const [id, template] of Object.entries(messages)) {
      for (const count of [1, 2, 5, 22]) {
        expect(formatMessage(template, { name: "Article", count }, file.replace(".json", "")), `${file} ${id}`).not.toMatch(/[{}]/);
      }
    }
  });

  it("covers the same languages as the chat, so a translated admin never shows an English chat", () => {
    for (const file of files) expect(matchLocale(file.replace(".json", "")), file).toBe(file.replace(".json", ""));
  });
});
