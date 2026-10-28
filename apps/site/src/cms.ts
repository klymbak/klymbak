/**
 * The site's content as the build hands it over (see cms/normalize.ts): one SiteContent per locale,
 * Markdown already rendered. Fields ending in `Html` hold that HTML; everything else is plain text.
 */

export interface Link {
  label: string;
  url: string;
  /** Shown instead of the label where space is tight. */
  shortLabel?: string;
  variant: "plain" | "primary" | "secondary";
  newTab: boolean;
}

export interface Media {
  url: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface Seo {
  title?: string;
  description?: string;
  image?: Media;
  noIndex: boolean;
}

export interface Snippet {
  file: string;
  source: string;
  language?: string;
}

export interface Card {
  key?: string;
  label?: string;
  title?: string;
  textHtml?: string;
  points: string[];
  detail?: string;
  link?: Link;
  image?: Media;
}

export interface Step {
  key?: string;
  title: string;
  duration?: string;
  bodyHtml?: string;
  points: string[];
  outcome?: string;
  code: Snippet[];
}

interface Head {
  anchor?: string;
  eyebrow?: string;
  heading?: string;
  ledeHtml?: string;
}

export type Section =
  | (Head & { type: "hero"; heading: string; highlight?: string; actions: Link[]; facts: { term: string; text: string }[]; image?: Media })
  | (Head & { type: "cards"; layout: "grid" | "list" | "table" | "timeline" | "columns"; items: Card[] })
  | (Head & { type: "steps"; outcomeLabel?: string; items: Step[] })
  | (Head & { type: "feature"; points: string[]; actions: Link[]; code: Snippet[]; image?: Media })
  | (Head & { type: "faq"; items: { question: string; answerHtml: string }[] })
  | (Head & { type: "cta"; heading: string; actions: Link[] })
  | (Head & { type: "rich-text"; bodyHtml: string })
  | (Head & { type: "custom"; name: string });

export interface Page {
  slug: string;
  title: string;
  seo: Seo;
  sections: Section[];
}

export interface SiteContent {
  locale: string;
  name: string;
  url?: string;
  tagline?: string;
  logo?: Media;
  contactEmail?: string;
  navigation: Link[];
  actions: Link[];
  footerHtml?: string;
  footerLinks: Link[];
  seo: Seo;
  /** By slug; the home page is `home`. */
  pages: Record<string, Page>;
  /** UI texts: group name → key → text. */
  texts: Record<string, Record<string, string>>;
}

export interface Content {
  defaultLocale: string;
  /** Locales with a published home page, the default first. */
  locales: string[];
  sites: Record<string, SiteContent>;
}
