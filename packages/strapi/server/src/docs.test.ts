import { describe, expect, it, vi } from "vitest";
import { cleanPage, DocsIndex, docsTools, pageExcerpt, pagePath, parseIndex, stem } from "./docs.ts";

// Real lines from https://docs.strapi.io/llms.txt (October 2026).
const LLMS_TXT = `# Strapi Documentation

- [Locales & translations](https://docs.strapi.io/cms/admin-panel-customization/locales-translations.md): Configure the admin panel languages by updating the config.locales array and override default or plugin strings with config.translations or custom translation files.
- [Upload files](https://docs.strapi.io/cms/api/rest/upload.md): The /api/upload REST API endpoints enable you to upload files to the Media Library, retrieve paginated file lists, update file metadata, and delete files from your Strapi application.
- [Create new Role-Based Access Control (RBAC) conditions](https://docs.strapi.io/cms/configurations/guides/rbac.md): Create custom Role-Based Access Control (RBAC) conditions in Strapi using the conditionProvider API to restrict admin panel access based on user properties, entity queries, or external conditions.
- [Content-type Builder](https://docs.strapi.io/cms/features/content-type-builder.md): The Content-type Builder is a tool for designing content types and components. This documentation gives an overview of the Content-type Builder and covers field options, relations, component usage, and shares data modeling tips.
- [Custom Fields](https://docs.strapi.io/cms/features/custom-fields.md): Custom Fields extend Strapi with new field types that behave like native fields in the Content‑type Builder and Content Manager. Instructions in this documentation cover building or installing fields via plugins and registering them programmatically.
- [Draft & Publish](https://docs.strapi.io/cms/features/draft-and-publish.md): Draft & Publish separates drafts from live entries, allowing editors to stage content before release. This documentation shows how to enable it per content type and manage publish or unpublish actions.
- [Internationalization](https://docs.strapi.io/cms/features/internationalization.md): Internationalization manages content in multiple locales directly from the admin panel. This documentation explains how to add locales, translate entries, and control locale-specific permissions.
- [Media Library](https://docs.strapi.io/cms/features/media-library.md): Media Library centralizes all uploaded assets with search, filters, and folder organization. This documentation includes provider options, upload workflows, and explanations on inserting media into content.
- [Role-Based Access Control (RBAC)](https://docs.strapi.io/cms/features/rbac.md): Role-Based Access Control (RBAC) manages administrator roles and granular permissions in the admin panel. This documentation covers creating roles, assigning rights, and securing administrative workflows.
- [Releases](https://docs.strapi.io/cms/features/releases.md): Releases group entries into publishable batches to trigger simultaneous publish or unpublish actions across content types and locales. Instructions in this documentation detail creating releases, adding entries, and understanding plan limitations.
- [Users & Permissions](https://docs.strapi.io/cms/features/users-permissions.md): Users & Permissions manages end-user accounts, JWT-based authentication, and role-based access to APIs. This documentation explains how to create roles, configure permissions, and secure access to your content API.
- [Internationalization (i18n)  is now part of the strapi core](https://docs.strapi.io/cms/migration/v4-to-v5/breaking-changes/i18n-content-manager-locale.md): Internationalization (i18n) is now part of Strapi core instead of a plugin. The locale parameter sent to Content Manager changes from plugins[i18n][locale] in v4 to locale in v5.
`;

describe("docs index", () => {
  it("parses llms.txt into pages", () => {
    const pages = parseIndex(LLMS_TXT);
    expect(pages).toHaveLength(12);
    expect(pages.find((page) => page.path === "cms/features/rbac")).toEqual({
      path: "cms/features/rbac",
      title: "Role-Based Access Control (RBAC)",
      summary: expect.stringMatching(/^Role-Based Access Control \(RBAC\) manages administrator roles/),
    });
  });

  it("accepts a page as a path, a link or a Markdown URL", () => {
    for (const reference of ["cms/features/rbac", "/cms/features/rbac/", "https://docs.strapi.io/cms/features/rbac.md", "https://docs.strapi.io/cms/features/rbac#roles"]) {
      expect(pagePath(reference)).toBe("cms/features/rbac");
    }
  });

  it("stems words so plurals and verb forms match", () => {
    expect(new Set(["translate", "translation", "translations", "translating"].map(stem))).toEqual(new Set(["translat"]));
    expect(stem("roles")).toBe(stem("role"));
    expect(stem("entries")).toBe("entry");
    expect(stem("access")).toBe("access");
  });

  it("puts the admin feature page first for editors' questions", () => {
    const docs = new DocsIndex(parseIndex(LLMS_TXT));
    const first = (query: string) => docs.search(query)[0]?.path;
    const top2 = (query: string) => docs.search(query, 2).map((page) => page.path);
    expect(first("How do I translate an article into French?")).toBe("cms/features/internationalization");
    expect(first("add a new language")).toBe("cms/features/internationalization");
    expect(first("give authors permission to publish articles")).toBe("cms/features/rbac");
    expect(first("upload images")).toBe("cms/features/media-library");
    // With a dozen pages "field" and "publish" look rare; on the full index these come first too.
    expect(top2("add a new field to articles")).toContain("cms/features/content-type-builder");
    expect(top2("schedule publishing for next monday")).toContain("cms/features/releases");
    expect(docs.search("the and of")).toEqual([]);
  });
});

describe("docs pages", () => {
  it("drops Docusaurus leftovers and makes links absolute", () => {
    const page = cleanPage(
      [
        "# Content-type Builder",
        "",
        "> Source: https://docs.strapi.io/cms/features/content-type-builder",
        "",
        '#### <img width="28" src="/img/assets/icons/v5/ctb_text.svg" /> Text {#text}',
        "",
        '- <span style={{color:"#5cb176"}}>Published</span>: see the [Content Manager](/cms/features/content-manager#overview).',
        "![Screenshot](/img/assets/ctb.png)",
        "<!-- hidden -->",
      ].join("\n"),
    );
    expect(page).toBe(
      "# Content-type Builder\n\n#### Text\n\n- Published: see the [Content Manager](https://docs.strapi.io/cms/features/content-manager#overview).",
    );
  });

  it("returns a long page's outline, then one section with its subsections", () => {
    const filler = "Lorem ipsum dolor sit amet. ".repeat(400);
    const page = `# Media Library\n\nIntro.\n\n## Configuration\n\n${filler}\n\n## Usage\n\n### Uploading assets\n\nDrag files in.\n\n\`\`\`\n## not a heading\n\`\`\`\n\n### Organizing assets\n\nUse folders.\n\n## Providers\n\n${filler}`;
    const overview = pageExcerpt(page);
    expect(overview).toContain("Intro.");
    expect(overview).toContain("- Usage\n  - Uploading assets\n  - Organizing assets\n- Providers");
    expect(overview).not.toContain("not a heading");
    expect(overview).not.toContain("Lorem");

    const usage = pageExcerpt(page, "usage");
    expect(usage).toMatch(/^## Usage[\s\S]*Drag files in\.[\s\S]*Use folders\.$/);
    expect(pageExcerpt(page, "Organizing")).toBe("### Organizing assets\n\nUse folders.");
    expect(pageExcerpt(page, "Webhooks")).toMatch(/^This page has no section "Webhooks"/);
  });
});

describe("docs tools", () => {
  const ctx = { signal: new AbortController().signal, user: { id: "1", name: "Editor", roles: [] } } as any;

  function setup(pages: Record<string, string>) {
    const requests: string[] = [];
    const fetch = (async (url: string) => {
      requests.push(url);
      const path = new URL(url).pathname;
      if (path === "/llms.txt") return new Response(LLMS_TXT);
      return path in pages ? new Response(pages[path]) : new Response("Not found", { status: 404 });
    }) as typeof globalThis.fetch;
    const [search, read] = docsTools({ fetch });
    return { search: search!, read: read!, requests };
  }

  it("searches the index, fetching it once", async () => {
    const { search, requests } = setup({});
    const result = await search.execute({ query: "translate entries" }, ctx);
    expect(result).toMatch(/^Strapi docs pages for "translate entries"[\s\S]*\n- cms\/features\/internationalization: Internationalization\./);
    await search.execute({ query: "roles" }, ctx);
    expect(requests).toEqual(["https://docs.strapi.io/llms.txt"]);
  });

  it("reads a page with its source and a link, and explains unknown pages", async () => {
    const { read } = setup({ "/cms/features/rbac.md": "# RBAC\n\n> Source: https://docs.strapi.io/cms/features/rbac\n\nRoles live in Settings." });
    const page = (await read.execute({ page: "https://docs.strapi.io/cms/features/rbac" }, ctx)) as { text: string; ui: unknown };
    expect(page.text).toBe("Source: https://docs.strapi.io/cms/features/rbac\n\n# RBAC\n\nRoles live in Settings.");
    expect(page.ui).toEqual({ type: "actions", actions: [{ label: "Open in Strapi docs", kind: "link", href: "https://docs.strapi.io/cms/features/rbac" }] });
    // People read the link in their language; the model reads the page as it is.
    const german = (await read.execute({ page: "cms/features/rbac" }, { ...ctx, user: { ...ctx.user, locale: "de-AT" } })) as { text: string; ui: unknown };
    expect(german.text).toBe(page.text);
    expect(german.ui).toMatchObject({ actions: [{ label: "In der Strapi-Doku öffnen" }] });

    expect(await read.execute({ page: "cms/features/teleport" }, ctx)).toEqual({ text: expect.stringMatching(/^There is no Strapi docs page/), isError: true });
    expect(await read.execute({ page: "../../etc/passwd" }, ctx)).toEqual({ text: expect.stringMatching(/isn't a Strapi docs page/), isError: true });
  });

  const offline = (async () => {
    throw new Error("getaddrinfo ENOTFOUND docs.strapi.io");
  }) as typeof fetch;

  it("tells the model when the docs can't be reached", async () => {
    const [search] = docsTools({ fetch: offline, offlineIndex: false });
    expect(await search!.execute({ query: "roles" }, ctx)).toEqual({
      text: expect.stringMatching(/^Couldn't read the Strapi docs at https:\/\/docs\.strapi\.io \(getaddrinfo ENOTFOUND/),
      isError: true,
    });
  });

  it("searches the copy of the index shipped with the plugin when the site can't be reached", async () => {
    const [search, read] = docsTools({ fetch: offline });
    const result = (await search!.execute({ query: "let authors publish" }, ctx)) as string;
    expect(result).toMatch(/^Strapi docs pages for "let authors publish" \(from the copy of the docs index that ships with the plugin \(\d{4}-\d{2}-\d{2}\)/);
    expect(result).toContain("- cms/features/rbac: Role-Based Access Control (RBAC).");

    // Pages need the site; the model still gets the page's summary.
    expect(await read!.execute({ page: "cms/features/rbac" }, ctx)).toEqual({
      text: expect.stringMatching(/^Couldn't read the Strapi docs.*The docs index describes this page as: Role-Based Access Control \(RBAC\)\. /),
      isError: true,
    });
  });

  it("prefers an index it fetched earlier to the shipped copy", async () => {
    let up = true;
    const fetch = (async (url: string) => {
      if (!up) throw new Error("ECONNRESET");
      return new URL(url).pathname === "/llms.txt" ? new Response(LLMS_TXT) : new Response("Not found", { status: 404 });
    }) as typeof globalThis.fetch;
    const [search] = docsTools({ fetch, offlineIndex: { fetched: "2020-01-01", lines: ["- [Old page](https://docs.strapi.io/old.md): Old."] } });
    await search!.execute({ query: "roles" }, ctx);
    up = false;
    const now = Date.now();
    const later = vi.spyOn(Date, "now").mockReturnValue(now + 25 * 60 * 60_000);
    const result = (await search!.execute({ query: "roles" }, ctx)) as string;
    later.mockRestore();
    expect(result).toContain("cms/features/rbac");
    expect(result).not.toContain("ships with the plugin");
  });
});
