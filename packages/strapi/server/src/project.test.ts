import { describe, expect, it } from "vitest";
import { describeProject, type ProjectFacts } from "./project.ts";

const facts: ProjectFacts = {
  version: "5.58.0",
  development: true,
  locales: [
    { name: "English (en)", code: "en", isDefault: true },
    { name: "Ukrainian", code: "uk-UA", isDefault: false },
  ],
  plugins: ["upload", "i18n", "seo"],
  roles: ["Author"],
  contentTypes: [
    { name: "Article", uid: "api::article.article", kind: "collection", draftAndPublish: true, localized: true, may: ["create", "update"] },
    { name: "About", uid: "api::about.about", kind: "single", draftAndPublish: false, localized: false, may: [] },
  ],
};

describe("project facts", () => {
  it("describes the project for the system prompt", () => {
    expect(describeProject(facts)).toBe(
      [
        "## This Strapi project",
        "- Strapi 5.58.0, Community Edition without a license. Docs pages say which plan a feature needs.",
        "- Running in development mode (`strapi develop`): the Content-type Builder can change content types and components. Saving there restarts the server.",
        "- Locales: English (en), default; Ukrainian (uk-UA). Localized content types (one version per locale): Article; the others have one version.",
        "- Plugins: Media Library (upload), Internationalization (i18n), seo.",
        "- The person's Strapi role: Author.",
        "- Content types the person can read (list_content_types shows their fields):",
        "  - Article (api::article.article): collection, Draft & Publish, localized. Can read, create, update.",
        "  - About (api::about.about): single. Can read.",
      ].join("\n"),
    );
  });

  it("covers production, licenses, one locale and roles that can't read content", () => {
    const text = describeProject({ ...facts, development: false, license: { type: "gold", features: ["sso"] }, locales: [], contentTypes: [] });
    expect(text).toContain("- Strapi 5.58.0, licensed (gold; features: sso).");
    expect(text).toContain("- Not in development mode: content types can't be changed from the admin.");
    expect(text).toContain("- Internationalization is off: content has one locale.");
    expect(text).toContain("- The person's role can't read any content types.");
  });

  it("says when locales exist but no content type is localized", () => {
    const types = facts.contentTypes!.map((type) => ({ ...type, localized: false }));
    expect(describeProject({ ...facts, contentTypes: types })).toContain(
      "default; Ukrainian (uk-UA). No content type the person can read is localized: each entry has one version",
    );
  });

  it("leaves content types out when the content tools are off, and caps long lists", () => {
    const text = describeProject({ ...facts, contentTypes: undefined });
    expect(text).not.toContain("Content types");
    expect(text).toContain("- Locales: English (en), default; Ukrainian (uk-UA).\n");
    const many = Array.from({ length: 45 }, (_, i) => ({ ...facts.contentTypes![1]!, name: `Type ${i}`, uid: `api::t${i}.t${i}` }));
    expect(describeProject({ ...facts, contentTypes: many })).toContain("  - …and 5 more: call list_content_types.");
  });
});
