import MarkdownIt from "markdown-it";
import type { Card, Content, Link, Media, Page, Section, Seo, SiteContent, Snippet, Step } from "../src/cms.ts";
import type { Entry, Snapshot } from "./strapi.ts";

// Editors write Markdown. HTML inside it shows as text and is never rendered.
const md = new MarkdownIt({ html: false });
const renderLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  if (/^https?:\/\//.test(tokens[idx]!.attrGet("href") ?? "")) {
    tokens[idx]!.attrSet("target", "_blank");
    tokens[idx]!.attrSet("rel", "noopener");
  }
  return renderLink(tokens, idx, options, env, self);
};

/** For fields shown inside a paragraph or heading. */
const inline = (text?: string | null) => (text ? md.renderInline(text) : undefined);
/** For fields that may hold several paragraphs. */
const block = (text?: string | null) => (text ? md.render(text) : undefined);
/** `points` fields: one item per line. */
const lines = (text?: string | null) => (text ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
const optional = <T>(value: T | null | undefined): T | undefined => value ?? undefined;

const link = (entry: Entry): Link => ({
  label: entry.label,
  url: entry.url,
  shortLabel: optional(entry.shortLabel),
  variant: entry.variant ?? "plain",
  newTab: Boolean(entry.newTab),
});
const links = (entries?: Entry[] | null) => (entries ?? []).map(link);
const snippets = (entries?: Entry[] | null): Snippet[] =>
  (entries ?? []).map((entry) => ({ file: entry.filename ?? "", source: entry.code, language: optional(entry.language) }));

/** Turns a snapshot into what the components read. `baseUrl` makes uploaded files' paths absolute. */
export function normalize(snapshot: Snapshot, baseUrl: string): Content {
  const media = (entry?: Entry | null): Media | undefined =>
    entry
      ? {
          url: /^https?:\/\//.test(entry.url) ? entry.url : `${baseUrl}${entry.url}`,
          alt: entry.alternativeText ?? "",
          width: optional(entry.width),
          height: optional(entry.height),
        }
      : undefined;
  const seo = (entry?: Entry | null): Seo => ({
    title: optional(entry?.metaTitle),
    description: optional(entry?.metaDescription),
    image: media(entry?.shareImage),
    noIndex: Boolean(entry?.noIndex),
  });
  const card = (entry: Entry): Card => ({
    key: optional(entry.key),
    label: optional(entry.label),
    title: optional(entry.title),
    textHtml: inline(entry.text),
    points: lines(entry.points),
    detail: optional(entry.detail),
    link: entry.link ? link(entry.link) : undefined,
    image: media(entry.image),
  });
  const step = (entry: Entry): Step => ({
    key: optional(entry.key),
    title: entry.title,
    duration: optional(entry.duration),
    bodyHtml: inline(entry.body),
    points: lines(entry.points),
    outcome: optional(entry.outcome),
    code: snippets(entry.code),
  });

  const section = (entry: Entry): Section | undefined => {
    const head = { anchor: optional(entry.anchor), eyebrow: optional(entry.eyebrow), heading: optional(entry.heading), ledeHtml: inline(entry.lede) };
    switch (entry.__component) {
      case "sections.hero":
        return {
          ...head,
          type: "hero",
          heading: entry.heading,
          highlight: optional(entry.highlight),
          actions: links(entry.actions),
          facts: (entry.facts ?? []).map((fact: Entry) => ({ term: fact.term, text: fact.text })),
          image: media(entry.image),
        };
      case "sections.cards":
        return { ...head, type: "cards", layout: entry.layout ?? "grid", items: (entry.items ?? []).map(card) };
      case "sections.steps":
        return { ...head, type: "steps", outcomeLabel: optional(entry.outcomeLabel), items: (entry.items ?? []).map(step) };
      case "sections.feature":
        return { ...head, type: "feature", points: lines(entry.points), actions: links(entry.actions), code: snippets(entry.code), image: media(entry.image) };
      case "sections.faq":
        return { ...head, type: "faq", items: (entry.items ?? []).map((item: Entry) => ({ question: item.question, answerHtml: block(item.answer) ?? "" })) };
      case "sections.cta":
        return { ...head, type: "cta", heading: entry.heading, actions: links(entry.actions) };
      case "sections.rich-text":
        return { ...head, type: "rich-text", bodyHtml: block(entry.body) ?? "" };
      case "sections.custom":
        return { ...head, type: "custom", name: entry.name };
      default:
        // A section type added in Strapi but not drawn here yet: leave it out rather than fail the build.
        return undefined;
    }
  };
  const page = (entry: Entry): Page => ({
    slug: entry.slug,
    title: entry.title,
    seo: seo(entry.seo),
    sections: (entry.sections ?? []).map(section).filter((item: Section | undefined): item is Section => Boolean(item)),
  });

  const sites: Record<string, SiteContent> = {};
  for (const [locale, { site, pages, uiTexts }] of Object.entries(snapshot.locales)) {
    sites[locale] = {
      locale,
      name: site.name,
      url: optional(site.url),
      tagline: optional(site.tagline),
      logo: media(site.logo),
      contactEmail: optional(site.contactEmail),
      navigation: links(site.navigation),
      actions: links(site.actions),
      footerHtml: block(site.footerText),
      footerLinks: links(site.footerLinks),
      seo: seo(site.seo),
      pages: Object.fromEntries(pages.map((entry) => [entry.slug, page(entry)])),
      texts: Object.fromEntries(uiTexts.map((text) => [text.name, Object.fromEntries((text.entries ?? []).map((item: Entry) => [item.key, item.text]))])),
    };
  }

  const { defaultLocale } = snapshot;
  if (!sites[defaultLocale]?.pages.home) throw new Error(`The ${defaultLocale} version of site "${snapshot.site}" has no published home page.`);
  // A locale goes live with its home page.
  const locales = [defaultLocale, ...Object.keys(sites).filter((locale) => locale !== defaultLocale && sites[locale]!.pages.home)];
  return { defaultLocale, locales, sites: Object.fromEntries(locales.map((locale) => [locale, sites[locale]!])) };
}
