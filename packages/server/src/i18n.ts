import { matchLocale, messageParts, validLocale, type MessageValues } from "@klymbak/protocol";

/** Text for people, in their language: one string for everyone, or a function of the person's locale. */
export type Localized = string | ((locale: string | undefined) => string);

export function localize(text: Localized, locale: string | undefined): string {
  return typeof text === "function" ? text(locale) : text;
}

/** Puts messages into the language closest to a locale, English when there is none. */
export interface Translator<Id extends string> {
  (locale: string | undefined, id: Id, values?: MessageValues): string;
  /** The languages with messages, English first. */
  readonly locales: readonly string[];
}

/**
 * Messages in several languages, for text a person reads: tool labels, approval titles, UI blocks. Tools find the
 * person's language in `ctx.user.locale`. `en` has every message; another language may miss some, which are then
 * shown in English. Messages use ICU MessageFormat's basics: `{name}`, `{count, plural, one {# entry} other {# entries}}`
 * and `{kind, select, draft {…} other {…}}`.
 *
 * ```ts
 * const t = createTranslator({ "refund.title": "Refund {amount}" }, { de: { "refund.title": "{amount} erstatten" } });
 * t(ctx.user.locale, "refund.title", { amount: "€20" });
 * ```
 */
export function createTranslator<M extends Record<string, string>>(
  en: M,
  translations: Record<string, Partial<Record<keyof M, string>>> = {},
): Translator<keyof M & string> {
  const available = Object.keys(translations);
  const matches = new Map<string, string | undefined>();
  const closest = (locale: string | undefined) => {
    const key = locale ?? "";
    if (!matches.has(key)) {
      // Locales come from request headers, so anyone can send new ones: start over rather than grow without bound.
      if (matches.size >= 100) matches.clear();
      matches.set(key, matchLocale(locale, available));
    }
    return matches.get(key);
  };
  const translate = (locale: string | undefined, id: keyof M & string, values: MessageValues = {}) => {
    const match = closest(locale);
    const translated = match ? translations[match]?.[id] : undefined;
    // Plural rules follow the message's language; numbers follow the person's.
    return messageParts(translated ?? en[id] ?? id, values, translated ? match : "en", validLocale(locale))
      .map((part) => part.text)
      .join("");
  };
  return Object.assign(translate, { locales: ["en", ...available] });
}

/** The first language of an Accept-Language header, by preference: "de-AT,de;q=0.9,en;q=0.8" gives "de-AT". */
export function preferredLocale(header: string | null | undefined): string | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(",")
    .map((entry, index) => {
      const [tag = "", ...params] = entry.trim().split(";");
      const q = params.map((param) => /^\s*q=([\d.]+)\s*$/.exec(param)?.[1]).find(Boolean);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), index };
    })
    .filter((entry) => entry.tag && entry.tag !== "*" && entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  for (const { tag } of ranked) {
    const valid = validLocale(tag);
    if (valid) return valid;
  }
  return undefined;
}
