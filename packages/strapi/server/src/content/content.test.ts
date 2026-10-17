import { describe, expect, it } from "vitest";
import { blocksToMarkdown, markdownToBlocks, type Block } from "./blocks.ts";
import { buildPopulate, describeModel, guessMainField, type Model } from "./model.ts";
import { entryMedia, normalizeInput, removedFields, shapeEntry } from "./shape.ts";

const models: Record<string, Model> = {
  "api::article.article": {
    uid: "api::article.article",
    kind: "collectionType",
    info: { displayName: "Article", pluralName: "articles" },
    options: { draftAndPublish: true },
    attributes: {
      title: { type: "string", required: true },
      body: { type: "blocks" },
      notes: { type: "richtext" },
      cover: { type: "media", multiple: false, allowedTypes: ["images"] },
      author: { type: "relation", relation: "manyToOne", target: "api::author.author" },
      tags: { type: "relation", relation: "manyToMany", target: "api::tag.tag" },
      seo: { type: "component", component: "shared.seo" },
      sections: { type: "dynamiczone", components: ["shared.quote", "shared.text"] },
      createdBy: { type: "relation", relation: "oneToOne", target: "admin::user", private: true },
      secret: { type: "string", private: true },
    },
  },
  "api::author.author": { uid: "api::author.author", info: { displayName: "Author" }, attributes: { name: { type: "string" }, email: { type: "email" } } },
  "api::tag.tag": { uid: "api::tag.tag", info: { displayName: "Tag" }, attributes: { slug: { type: "uid" } } },
  "shared.seo": { uid: "shared.seo", info: { displayName: "Seo" }, attributes: { metaTitle: { type: "string" }, image: { type: "media" } } },
  "shared.quote": { uid: "shared.quote", info: { displayName: "Quote" }, attributes: { text: { type: "text" } } },
  "shared.text": { uid: "shared.text", info: { displayName: "Text" }, attributes: { body: { type: "blocks" } } },
};
const getModel = (uid: string) => models[uid];
const article = models["api::article.article"]!;

describe("Blocks ↔ Markdown", () => {
  const blocks: Block[] = [
    { type: "heading", level: 2, children: [{ type: "text", text: "Why we write" }] },
    {
      type: "paragraph",
      children: [
        { type: "text", text: "Plain, " },
        { type: "text", text: "bold", bold: true },
        { type: "text", text: " and " },
        { type: "link", url: "https://strapi.io", children: [{ type: "text", text: "a link" }] },
        { type: "text", text: " with " },
        { type: "text", text: "code", code: true },
      ],
    },
    {
      type: "list",
      format: "unordered",
      children: [
        { type: "list-item", children: [{ type: "text", text: "one" }] },
        { type: "list", format: "ordered", children: [{ type: "list-item", children: [{ type: "text", text: "nested" }] }] },
        { type: "list-item", children: [{ type: "text", text: "two", italic: true }] },
      ],
    },
    { type: "quote", children: [{ type: "text", text: "Dig it." }] },
    { type: "code", language: "ts", children: [{ type: "text", text: "const a = 1;" }] },
  ];

  it("writes Markdown the model can read", () => {
    expect(blocksToMarkdown(blocks)).toBe(
      "## Why we write\n\nPlain, **bold** and [a link](https://strapi.io) with `code`\n\n- one\n  1. nested\n- *two*\n\n> Dig it.\n\n```ts\nconst a = 1;\n```",
    );
  });

  it("reads Markdown back into the same blocks", () => {
    expect(markdownToBlocks(blocksToMarkdown(blocks))).toEqual(blocks);
  });

  it("turns Markdown images into links, since image blocks need uploaded media", () => {
    expect(markdownToBlocks("![A lake](https://example.com/lake.jpg)")).toEqual([
      { type: "paragraph", children: [{ type: "link", url: "https://example.com/lake.jpg", children: [{ type: "text", text: "A lake" }] }] },
    ]);
  });

  it("makes Markdown images of Media Library files image blocks, and keeps other images links", () => {
    const owl = { url: "/uploads/owl.jpg", name: "owl.jpg", alternativeText: null, width: 800, height: 600, mime: "image/jpeg" };
    const lookup = (url: string) => (url === owl.url ? owl : undefined);
    const blocks = markdownToBlocks("Before.\n\n![An owl](/uploads/owl.jpg)\n\n![Elsewhere](https://example.com/x.jpg)", lookup);
    expect(blocks).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "Before." }] },
      { type: "image", image: { ...owl, alternativeText: "An owl" }, children: [{ type: "text", text: "" }] },
      { type: "paragraph", children: [{ type: "link", url: "https://example.com/x.jpg", children: [{ type: "text", text: "Elsewhere" }] }] },
    ]);
    expect(blocksToMarkdown(blocks)).toBe("Before.\n\n![An owl](/uploads/owl.jpg)\n\n[Elsewhere](https://example.com/x.jpg)");

    // Also inside components and dynamic zones.
    const { data } = normalizeInput(article, { sections: [{ __component: "shared.text", body: "![](/uploads/owl.jpg)" }] }, getModel, lookup);
    expect(data).toEqual({ sections: [{ __component: "shared.text", body: [{ type: "image", image: owl, children: [{ type: "text", text: "" }] }] }] });
  });

  it("keeps an empty paragraph for empty text, as Strapi requires one", () => {
    expect(markdownToBlocks("  \n")).toEqual([{ type: "paragraph", children: [{ type: "text", text: "" }] }]);
  });
});

describe("content model", () => {
  it("picks a label field the way editors would", () => {
    expect(guessMainField(article)).toBe("title");
    expect(guessMainField(models["api::author.author"]!)).toBe("name");
    expect(guessMainField(models["api::tag.tag"]!)).toBe("slug");
  });

  it("describes fields and components without private ones", () => {
    const text = describeModel(article, getModel);
    expect(text).toContain("Article (api::article.article): collection type.");
    expect(text).toContain("Draft & Publish");
    expect(text).toContain("- title: string (required)");
    expect(text).toContain("- body: rich text. Read and write it as Markdown");
    expect(text).toContain("- tags: relation to many api::tag.tag");
    expect(text).toContain("Component shared.seo (Seo):");
    expect(text).toContain("Component shared.text (Text):");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("createdBy");
  });

  it("populates labels of related entries, media and components, but never admin users", () => {
    const labelOf = (uid: string) => (uid === "api::author.author" ? "name" : undefined);
    expect(buildPopulate(article, getModel, { depth: 0, toMany: false, labelOf })).toEqual({
      cover: { fields: ["name", "url", "alternativeText", "mime"] },
      author: { fields: ["name"] },
    });
    expect(buildPopulate(article, getModel, { depth: 2, toMany: true, labelOf })).toEqual({
      cover: { fields: ["name", "url", "alternativeText", "mime"] },
      author: { fields: ["name"] },
      tags: { fields: ["documentId"] },
      seo: { populate: { image: { fields: ["name", "url", "alternativeText", "mime"] } } },
      sections: { on: { "shared.quote": true, "shared.text": true } },
    });
  });
});

describe("shaping entries", () => {
  it("drops database ids and shows rich text as Markdown, also in dynamic zones", () => {
    const entry = {
      id: 7,
      documentId: "abc",
      title: "Hello",
      body: [{ type: "paragraph", children: [{ type: "text", text: "Hi", bold: true }] }],
      author: { id: 3, documentId: "au1", name: "Sarah" },
      sections: [{ id: 9, __component: "shared.text", body: [{ type: "paragraph", children: [{ type: "text", text: "Inner" }] }] }],
      createdBy: { id: 1, firstname: "Ada" },
    };
    expect(shapeEntry(article, entry, getModel)).toEqual({
      documentId: "abc",
      title: "Hello",
      body: "**Hi**",
      author: { documentId: "au1", name: "Sarah" },
      sections: [{ __component: "shared.text", body: "Inner" }],
    });
  });

  it("converts Markdown input for rich-text fields and reports fields it leaves out", () => {
    const { data, ignored } = normalizeInput(
      article,
      { title: "New", body: "Hello **world**", documentId: "x", publishedAt: "now", colour: "red", sections: [{ __component: "shared.text", body: "Inner", bogus: 1 }] },
      getModel,
    );
    expect(data).toEqual({
      title: "New",
      body: [{ type: "paragraph", children: [{ type: "text", text: "Hello " }, { type: "text", text: "world", bold: true }] }],
      sections: [{ __component: "shared.text", body: [{ type: "paragraph", children: [{ type: "text", text: "Inner" }] }] }],
    });
    expect(ignored).toEqual(["documentId (set by Strapi)", "publishedAt (set by Strapi)", "colour (no such field)", "sections[0].bogus (no such field)"]);
  });

  it("finds the fields a permission sanitizer removed", () => {
    expect(removedFields({ title: 1, slug: 2 }, { title: 1 })).toEqual(["slug"]);
  });

  it("collects an entry's media files, also from components and dynamic zones", () => {
    const file = (name: string) => ({ name, url: `/uploads/${name}`, alternativeText: null, mime: "image/png" });
    const entry = {
      title: "Hello",
      cover: file("cover.png"),
      seo: { metaTitle: "Hello", image: file("share.png") },
      sections: [{ __component: "shared.quote", text: "Hi" }, { __component: "shared.seo", image: file("inline.png") }],
    };
    expect(entryMedia(article, entry, getModel).map((f) => f.name)).toEqual(["cover.png", "share.png", "inline.png"]);
    expect(entryMedia(article, { title: "Bare", cover: null }, getModel)).toEqual([]);
  });
});
