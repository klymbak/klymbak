import { describe, expect, it } from "vitest";
import { mcpToolFlags, structuredUi } from "./mcp.ts";

describe("mcpToolFlags", () => {
  const tool = (name: string, annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean }) => ({ name, annotations });

  it("follows the tool's annotations by default", () => {
    expect(mcpToolFlags({}, tool("list_orders", { readOnlyHint: true }))).toEqual({ readOnly: true, approval: false });
    expect(mcpToolFlags({}, tool("delete_order", { destructiveHint: true }))).toEqual({ readOnly: false, approval: true });
    expect(mcpToolFlags({}, tool("update_order"))).toEqual({ readOnly: false, approval: false });
  });

  it("lets server config override them with a list or a predicate", () => {
    const readOnly = (name: string) => /^(list|get)_/.test(name);
    const approval = (name: string) => !readOnly(name);
    expect(mcpToolFlags({ readOnly, approval }, tool("get_article"))).toEqual({ readOnly: true, approval: false });
    expect(mcpToolFlags({ readOnly, approval }, tool("publish_article"))).toEqual({ readOnly: false, approval: true });
    expect(mcpToolFlags({ approval: ["refund"] }, tool("refund", { readOnlyHint: true }))).toEqual({ readOnly: true, approval: true });
    expect(mcpToolFlags({ approval: false }, tool("wipe", { destructiveHint: true }))).toEqual({ readOnly: false, approval: false });
  });
});

describe("structuredUi", () => {
  // The shape of Strapi's media_list_assets and media_get_asset results.
  const asset = {
    id: 1,
    name: "cover.png",
    alternativeText: null,
    caption: null,
    url: "/uploads/cover_29f3756a8e.png",
    mime: "image/png",
    size: 535.79,
    width: 1024,
    height: 1024,
    ext: ".png",
    folder: null,
  };

  it("shows files as a gallery", () => {
    expect(structuredUi({ results: [asset], pagination: { page: 1, total: 1 } })).toEqual([
      {
        type: "media",
        title: "Results",
        items: [{ url: "/uploads/cover_29f3756a8e.png", name: "cover.png", mime: "image/png", width: 1024, height: 1024 }],
      },
    ]);
    expect(structuredUi({ data: asset })).toEqual([{ type: "media", items: [expect.objectContaining({ name: "cover.png" })] }]);
    expect(structuredUi([{ url: "https://cdn.example.com/a.webp" }])?.[0]?.type).toBe("media");
  });

  it("shows other records, links included, as a table", () => {
    const links = { results: [{ title: "Quick start", url: "https://docs.strapi.io/cms/quick-start" }] };
    expect(structuredUi(links)).toEqual([expect.objectContaining({ type: "table", title: "Results" })]);
    expect(structuredUi({ data: { id: 1, name: "Folder" } })).toBeUndefined();
  });
});
