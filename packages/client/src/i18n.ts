import { matchLocale as closestLocale, messageParts, validLocale, type MessageFragment as MessagePart, type MessageValues, type ValueFormat } from "@klymbak/protocol";
import { en, type MessageId, type Messages } from "./messages.ts";

export { formatMessage, type MessageFragment as MessagePart, type MessageValues } from "@klymbak/protocol";

/** A message from the catalog, put into words by the UI that shows it, in its language. */
export interface Message {
  id: MessageId;
  values?: MessageValues;
}

/** Text for the UI to show: a string as is (from the server, say), or a message to translate. */
export type Text = string | Message;

export interface I18nOptions {
  /** The UI's language, a BCP 47 tag such as "fr" or "pt-BR". Numbers and dates follow it too. */
  locale?: string;
  /** Messages in that language, such as a catalog from `@klymbak/client/locales/fr`. Missing ones are shown in English. */
  messages?: Partial<Messages>;
}

/** Puts the components' words, numbers and dates into one language. */
export interface I18n {
  /** The UI's language; undefined means English words with the default formatting locale (see configureFormatting). */
  readonly locale: string | undefined;
  /** The messages given, before the English fallback. */
  readonly messages: Partial<Messages>;
  t(id: MessageId, values?: MessageValues): string;
  /** The message in pieces, so a UI can style the values (bold, a pill) without string concatenation. */
  parts(id: MessageId, values?: MessageValues): MessagePart[];
  /** A string as is, or a message translated. */
  text(value: Text): string;
  number(value: number): string;
  formatValue(value: unknown, format?: ValueFormat, currencyCode?: string): string;
  /** Compact axis labels: 12.5k, 1.2M. */
  compactNumber(value: number, format?: ValueFormat, currencyCode?: string): string;
  timeAgo(value: unknown): string;
  /** Common cron patterns in words; anything else stays the expression. */
  describeCron(expression: string): string;
  duration(ms: number): string;
}

// ---------------------------------------------------------------------------------------------
// Numbers and dates.

let defaultLocale: string | undefined;

/**
 * Sets the locale for numbers, money and dates wherever a component isn't given its own `locale`.
 * Defaults to the browser's locale; a store that reports in USD may prefer "en-US".
 */
export function configureFormatting(options: { locale?: string }) {
  defaultLocale = validLocale(options.locale);
}

const formats = new Map<string, unknown>();

function cached<T>(key: string, make: () => T): T {
  let value = formats.get(key) as T | undefined;
  if (value === undefined) {
    value = make();
    formats.set(key, value);
  }
  return value;
}

function numberFormat(locale: string | undefined, options: Intl.NumberFormatOptions) {
  return cached(`n|${locale}|${JSON.stringify(options)}`, () => new Intl.NumberFormat(locale, options));
}

function relativeFormat(locale: string | undefined) {
  return cached(`r|${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }));
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string" && value) {
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function sameYear(date: Date) {
  return date.getFullYear() === new Date().getFullYear();
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["minute", 60],
  ["hour", 3600],
  ["day", 86_400],
  ["week", 604_800],
  ["month", 2_629_800],
  ["year", 31_557_600],
];

export function createI18n({ locale: requested, messages = {} }: I18nOptions = {}): I18n {
  const locale = validLocale(requested);
  // Read at call time, so configureFormatting applies to components that have no locale of their own.
  const formatLocale = () => locale ?? defaultLocale;
  const template = (id: MessageId) => messages[id] ?? en[id] ?? id;
  const parts = (id: MessageId, values: MessageValues = {}) => messageParts(template(id), values, locale, formatLocale());
  const t = (id: MessageId, values?: MessageValues) =>
    parts(id, values)
      .map((part) => part.text)
      .join("");

  function timeAgo(value: unknown): string {
    const date = toDate(value);
    if (!date) return "";
    const seconds = (date.getTime() - Date.now()) / 1000;
    const abs = Math.abs(seconds);
    if (abs < 45) return t(seconds < 0 ? "time.justNow" : "time.inAMoment");
    let [unit, size] = RELATIVE_UNITS[0]!;
    for (const [name, length] of RELATIVE_UNITS) {
      if (abs >= length) [unit, size] = [name, length];
    }
    return relativeFormat(formatLocale()).format(Math.round(seconds / size), unit);
  }

  function formatValue(value: unknown, format?: ValueFormat, currencyCode = "USD"): string {
    if (value === null || value === undefined || value === "") return "—";
    const lang = formatLocale();
    switch (format) {
      case "currency":
        return typeof value === "number" || !Number.isNaN(Number(value))
          ? numberFormat(lang, { style: "currency", currency: currencyCode }).format(Number(value))
          : String(value);
      case "number":
        return typeof value === "number" ? numberFormat(lang, { maximumFractionDigits: 2 }).format(value) : String(value);
      case "integer":
        return typeof value === "number" ? numberFormat(lang, { maximumFractionDigits: 0 }).format(value) : String(value);
      case "percent":
        return typeof value === "number"
          ? `${numberFormat(lang, { maximumFractionDigits: 2 }).format(Math.abs(value) <= 1 ? value * 100 : value)}%`
          : String(value);
      case "date": {
        const date = toDate(value);
        return date ? date.toLocaleDateString(lang, { month: "short", day: "numeric", year: sameYear(date) ? undefined : "numeric" }) : String(value);
      }
      case "datetime": {
        const date = toDate(value);
        return date
          ? date.toLocaleString(lang, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", year: sameYear(date) ? undefined : "numeric" })
          : String(value);
      }
      case "relative":
        return timeAgo(value) || String(value);
      default:
        if (typeof value === "number") return numberFormat(lang, { maximumFractionDigits: 2 }).format(value);
        if (typeof value === "boolean") return t(value ? "common.yes" : "common.no");
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
    }
  }

  function describeCron(expression: string): string {
    const fields = expression.trim().split(/\s+/);
    if (fields.length !== 5) return expression;
    const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string];
    const time = /^\d+$/.test(minute) && /^\d+$/.test(hour) ? `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}` : undefined;
    if (dom === "*" && month === "*") {
      if (time && dow === "1-5") return t("cron.weekdays", { time });
      if (time && (dow === "0,6" || dow === "6,0")) return t("cron.weekends", { time });
      if (time && dow === "*") return t("cron.daily", { time });
      if (time && /^[0-6]$/.test(dow)) return t(`cron.weekly.${dow}` as MessageId, { time });
      const everyHours = /^\*\/(\d+)$/.exec(hour);
      if (minute === "0" && everyHours && dow === "*") return t("cron.everyHours", { count: Number(everyHours[1]) });
      if (minute === "0" && hour === "*" && dow === "*") return t("cron.hourly");
      const everyMinutes = /^\*\/(\d+)$/.exec(minute);
      if (everyMinutes && hour === "*" && dow === "*") return t("cron.everyMinutes", { count: Number(everyMinutes[1]) });
    }
    if (time && /^\d+$/.test(dom) && month === "*" && dow === "*") return t("cron.monthly", { day: dom, time });
    return expression;
  }

  return {
    locale,
    messages,
    t,
    parts,
    text: (value) => (typeof value === "string" ? value : t(value.id, value.values)),
    number: (value) => numberFormat(formatLocale(), { maximumFractionDigits: 2 }).format(value),
    formatValue,
    compactNumber: (value, format, currencyCode = "USD") =>
      numberFormat(formatLocale(), {
        notation: "compact",
        maximumFractionDigits: 1,
        ...(format === "currency" ? { style: "currency", currency: currencyCode } : {}),
      }).format(value),
    timeAgo,
    describeCron,
    duration: (ms) =>
      ms < 1000
        ? t("time.milliseconds", { ms: String(ms) })
        : t("time.seconds", { s: numberFormat(formatLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(ms / 1000) }),
  };
}

// ---------------------------------------------------------------------------------------------
// The catalogs that ship with Klymbak.

/** The languages Klymbak has messages for, besides English. */
export const locales = ["de", "es", "fr", "it", "ja", "ko", "nl", "pl", "pt-BR", "tr", "uk", "zh-Hans"] as const;
export type Locale = (typeof locales)[number];

const catalogs: Record<Locale, () => Promise<{ default: Messages }>> = {
  de: () => import("./locales/de.ts"),
  es: () => import("./locales/es.ts"),
  fr: () => import("./locales/fr.ts"),
  it: () => import("./locales/it.ts"),
  ja: () => import("./locales/ja.ts"),
  ko: () => import("./locales/ko.ts"),
  nl: () => import("./locales/nl.ts"),
  pl: () => import("./locales/pl.ts"),
  "pt-BR": () => import("./locales/pt-BR.ts"),
  tr: () => import("./locales/tr.ts"),
  uk: () => import("./locales/uk.ts"),
  "zh-Hans": () => import("./locales/zh-Hans.ts"),
};

/**
 * The catalog closest to a BCP 47 tag: "de-AT" gives "de", "pt" gives "pt-BR", "zh-CN" gives "zh-Hans".
 * Undefined for English and for languages Klymbak has no messages for.
 */
export function matchLocale(tag: string | undefined): Locale | undefined {
  return closestLocale(tag, locales);
}

/** Loads the catalog for a language (see matchLocale), or undefined when the components should stay in English. */
export async function loadMessages(tag: string | undefined): Promise<Messages | undefined> {
  const locale = matchLocale(tag);
  return locale ? (await catalogs[locale]()).default : undefined;
}
