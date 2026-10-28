import cms from "virtual:cms";
import type { Link, SiteContent } from "./cms.ts";

/** The content comes from Strapi at build time (cms/plugin.ts). The page's locale is the path's first part, if it names one. */
const first = location.pathname.split("/")[1] ?? "";
export const locale = cms.locales.includes(first) ? first : cms.defaultLocale;
export const locales = cms.locales;
export const site: SiteContent = cms.sites[locale]!;
export const home = site.pages.home!;
const fallback = cms.sites[cms.defaultLocale]!;

/** A UI text in the page's language, or the default locale's while it isn't translated, with {name} placeholders filled in. */
export function text(group: string, key: string, values: Record<string, string> = {}): string {
  const value = site.texts[group]?.[key] ?? fallback.texts[group]?.[key];
  if (value === undefined) {
    if (import.meta.env.DEV) console.warn(`[site] No UI text "${key}" in "${group}"`);
    return key;
  }
  return value.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

/** One item per line, as UI texts and `points` fields hold lists. */
export const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

/** Where a link goes: paths inside the site get the locale's prefix; anchors and other addresses stay as written. */
export const href = (url: string) => (url.startsWith("/") && !url.startsWith("//") && locale !== cms.defaultLocale ? `/${locale}${url}` : url);

/** The home page in another locale. */
export const localeHref = (code: string) => (code === cms.defaultLocale ? "/" : `/${code}/`);

/** A language's name in that language, such as “Čeština”. */
export const languageName = (code: string) => {
  const name = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
  return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
};

/** Buttons for a link: primary stays primary unless `demoted` (another button took the lead), the rest are outlined. */
export const buttonClass = (link: Link, demoted = false) => (link.variant === "primary" && !demoted ? "btn btn--primary" : "btn btn--ghost");

/** A production build without VITE_DEMO_URL has no demo to link to, so the demo buttons are hidden. */
export const demoUrl: string | undefined = import.meta.env.VITE_DEMO_URL ?? (import.meta.env.DEV ? "http://localhost:5173" : undefined);
