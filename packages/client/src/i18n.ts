import type { ValueFormat } from "@klymbak/protocol";
import { en, type MessageId, type Messages } from "./messages.ts";

export type MessageValues = Record<string, string | number>;

/** A message from the catalog, put into words by the UI that shows it, in its language. */
export interface Message {
  id: MessageId;
  values?: MessageValues;
}

/** Text for the UI to show: a string as is (from the server, say), or a message to translate. */
export type Text = string | Message;

/** A piece of a formatted message: literal text, or the value of the argument named `arg`. */
export interface MessagePart {
  text: string;
  arg?: string;
}

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
// Messages: a parser and formatter for the subset of ICU MessageFormat the catalogs use.

const HASH = { hash: true } as const;
type Node = string | typeof HASH | { arg: string } | { arg: string; type: "plural" | "selectordinal" | "select"; options: Record<string, Node[]> };

class Parser {
  private i = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  parse(): Node[] {
    const nodes = this.nodes(false, false);
    if (this.i < this.source.length) throw new SyntaxError(`Unexpected "}" at ${this.i}`);
    return nodes;
  }

  /** Text and arguments up to the end, or up to the `}` that closes a branch. */
  private nodes(inPlural: boolean, inBranch: boolean): Node[] {
    const out: Node[] = [];
    let text = "";
    const flush = () => {
      if (text) out.push(text);
      text = "";
    };
    while (this.i < this.source.length) {
      const ch = this.source[this.i]!;
      if (ch === "}") {
        if (inBranch) break;
        throw new SyntaxError(`Unexpected "}" at ${this.i}`);
      }
      if (ch === "'") text += this.quoted(inPlural);
      else if (ch === "{") {
        flush();
        this.i++;
        out.push(this.argument(inPlural));
      } else if (ch === "#" && inPlural) {
        flush();
        out.push(HASH);
        this.i++;
      } else {
        text += ch;
        this.i++;
      }
    }
    flush();
    return out;
  }

  /** ICU quoting: '' is an apostrophe, and a quote before { } or # starts literal text that ends at the next quote. */
  private quoted(inPlural: boolean): string {
    const s = this.source;
    const next = s[this.i + 1];
    if (next === "'") {
      this.i += 2;
      return "'";
    }
    if (next !== "{" && next !== "}" && !(inPlural && next === "#")) {
      this.i++;
      return "'";
    }
    let text = "";
    this.i++;
    while (this.i < s.length) {
      if (s[this.i] === "'") {
        if (s[this.i + 1] !== "'") break;
        text += "'";
        this.i += 2;
      } else text += s[this.i++];
    }
    this.i++;
    return text;
  }

  private argument(inPlural: boolean): Node {
    const arg = this.until(",}").trim();
    if (!arg) throw new SyntaxError(`Empty argument at ${this.i}`);
    if (this.source[this.i++] === "}") return { arg };
    const type = this.until(",}").trim();
    if (type !== "plural" && type !== "selectordinal" && type !== "select") {
      // {n, number} and other formats show the value; their style is ignored.
      this.until("}");
      this.i++;
      return { arg };
    }
    if (this.source[this.i++] !== ",") throw new SyntaxError(`Expected options for ${arg}`);
    const options: Record<string, Node[]> = {};
    for (;;) {
      this.skipSpace();
      if (this.source[this.i] === "}") break;
      const selector = this.until("{} \t\n\r");
      this.skipSpace();
      if (!selector || this.source[this.i] !== "{") throw new SyntaxError(`Expected "{" after ${selector || "a selector"}`);
      this.i++;
      options[selector] = this.nodes(inPlural || type !== "select", true);
      if (this.source[this.i] !== "}") throw new SyntaxError(`Unclosed option ${selector}`);
      this.i++;
    }
    this.i++;
    if (!options.other) throw new SyntaxError(`${arg} needs an "other" option`);
    return { arg, type, options };
  }

  /** Reads up to (not past) one of the characters; the end of the source is an error. */
  private until(stops: string): string {
    const start = this.i;
    while (this.i < this.source.length && !stops.includes(this.source[this.i]!)) this.i++;
    if (this.i >= this.source.length) throw new SyntaxError("Unclosed argument");
    return this.source.slice(start, this.i);
  }

  private skipSpace() {
    while (/\s/.test(this.source[this.i] ?? "")) this.i++;
  }
}

const parsed = new Map<string, Node[]>();

function parse(template: string): Node[] {
  let nodes = parsed.get(template);
  if (!nodes) {
    try {
      nodes = new Parser(template).parse();
    } catch {
      // A malformed translation shows as written rather than breaking the UI.
      nodes = [template];
    }
    parsed.set(template, nodes);
  }
  return nodes;
}

interface Context {
  number(value: number): string;
  plural(value: number, ordinal: boolean): string;
}

function render(nodes: Node[], values: MessageValues, context: Context, out: MessagePart[], count?: number) {
  const text = (value: string) => {
    const last = out[out.length - 1];
    if (last && last.arg === undefined) last.text += value;
    else out.push({ text: value });
  };
  for (const node of nodes) {
    if (typeof node === "string") text(node);
    else if ("hash" in node) text(count === undefined ? "#" : context.number(count));
    else if ("options" in node) {
      const value = values[node.arg];
      if (node.type === "select") {
        render(node.options[String(value)] ?? node.options.other!, values, context, out, count);
      } else {
        const n = Number(value);
        const branch = node.options[`=${n}`] ?? node.options[context.plural(n, node.type === "selectordinal")] ?? node.options.other!;
        render(branch, values, context, out, n);
      }
    } else {
      const value = values[node.arg];
      // A missing value stays visible as {name}, so the mistake is easy to spot.
      out.push({ text: value === undefined ? `{${node.arg}}` : typeof value === "number" ? context.number(value) : value, arg: node.arg });
    }
  }
}

/** Formats an ICU message with its values, in the given locale's plural rules and number format. */
export function formatMessage(template: string, values: MessageValues = {}, locale?: string): string {
  return messageParts(template, values, locale)
    .map((part) => part.text)
    .join("");
}

function messageParts(template: string, values: MessageValues, locale: string | undefined, formatLocale = locale): MessagePart[] {
  const out: MessagePart[] = [];
  render(parse(template), values, {
    number: (value) => numberFormat(formatLocale, { maximumFractionDigits: 2 }).format(value),
    plural: (value, ordinal) => pluralRules(locale ?? "en", ordinal).select(value),
  }, out);
  return out;
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

function pluralRules(locale: string, ordinal: boolean) {
  return cached(`p|${locale}|${ordinal}`, () => new Intl.PluralRules(locale, { type: ordinal ? "ordinal" : "cardinal" }));
}

function relativeFormat(locale: string | undefined) {
  return cached(`r|${locale}`, () => new Intl.RelativeTimeFormat(locale, { numeric: "auto" }));
}

/** The tag if Intl accepts it, else undefined: a bad tag (say "en_US") would make every formatter throw. */
function validLocale(tag: string | undefined): string | undefined {
  if (!tag) return undefined;
  try {
    return Intl.getCanonicalLocales(tag.replace(/_/g, "-"))[0];
  } catch {
    return undefined;
  }
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
  const valid = validLocale(tag);
  if (!valid) return undefined;
  const exact = locales.find((locale) => locale.toLowerCase() === valid.toLowerCase());
  if (exact) return exact;
  const parsed = new Intl.Locale(valid);
  if (parsed.language === "zh") return parsed.maximize().script === "Hans" ? "zh-Hans" : undefined;
  if (parsed.language === "pt") return "pt-BR";
  return locales.find((locale) => locale === parsed.language);
}

/** Loads the catalog for a language (see matchLocale), or undefined when the components should stay in English. */
export async function loadMessages(tag: string | undefined): Promise<Messages | undefined> {
  const locale = matchLocale(tag);
  return locale ? (await catalogs[locale]()).default : undefined;
}
