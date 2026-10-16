import type { Tone, ValueFormat } from "@klymbak/protocol";

let locale: string | undefined;
let numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
let integerFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
let relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
const currencyFormats = new Map<string, Intl.NumberFormat>();

/**
 * Sets the locale for numbers, money and dates in every component.
 * Defaults to the browser's locale; a store that reports in USD may prefer "en-US".
 */
export function configureFormatting(options: { locale?: string }) {
  locale = options.locale;
  numberFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  integerFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  currencyFormats.clear();
}

function currency(code = "USD") {
  let format = currencyFormats.get(code);
  if (!format) {
    format = new Intl.NumberFormat(locale, { style: "currency", currency: code });
    currencyFormats.set(code, format);
  }
  return format;
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

export function timeAgo(value: unknown): string {
  const date = toDate(value);
  if (!date) return "";
  const seconds = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds < 0 ? "just now" : "in a moment";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86_400],
    ["week", 604_800],
    ["month", 2_629_800],
    ["year", 31_557_600],
  ];
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let size = 60;
  for (const [name, length] of units) {
    if (abs >= length) {
      unit = name;
      size = length;
    }
  }
  return relative.format(Math.round(seconds / size), unit);
}

/** Formats a cell or stat value for display. Unknown values fall back to String(). */
export function formatValue(value: unknown, format?: ValueFormat, currencyCode?: string): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (format) {
    case "currency":
      return typeof value === "number" || !Number.isNaN(Number(value)) ? currency(currencyCode).format(Number(value)) : String(value);
    case "number":
      return typeof value === "number" ? numberFormat.format(value) : String(value);
    case "integer":
      return typeof value === "number" ? integerFormat.format(value) : String(value);
    case "percent":
      return typeof value === "number" ? `${numberFormat.format(Math.abs(value) <= 1 ? value * 100 : value)}%` : String(value);
    case "date": {
      const date = toDate(value);
      return date ? date.toLocaleDateString(locale, { month: "short", day: "numeric", year: sameYear(date) ? undefined : "numeric" }) : String(value);
    }
    case "datetime": {
      const date = toDate(value);
      return date
        ? date.toLocaleString(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", year: sameYear(date) ? undefined : "numeric" })
        : String(value);
    }
    case "relative":
      return timeAgo(value) || String(value);
    default:
      if (typeof value === "number") return numberFormat.format(value);
      if (typeof value === "boolean") return value ? "Yes" : "No";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
  }
}

/** Compact axis labels: 12.5k, 1.2M. */
export function compactNumber(value: number, format?: ValueFormat, currencyCode = "USD"): string {
  const compact = new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
    ...(format === "currency" ? { style: "currency", currency: currencyCode } : {}),
  });
  return compact.format(value);
}

function sameYear(date: Date) {
  return date.getFullYear() === new Date().getFullYear();
}

export function toneClass(tone: Tone | undefined): string {
  return `kl-tone-${tone ?? "neutral"}`;
}

/** Fills "{key}" placeholders from a row. */
export function fillTemplate(template: string, row: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(row[key] ?? ""));
}

export function formatTokens(value: number | undefined): string {
  if (!value) return "0";
  return value >= 1000 ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k` : String(value);
}

export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1000)}k`;
}

/** Plain-English description of common cron patterns; falls back to the expression. */
export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;
  const [minute, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const time = /^\d+$/.test(minute) && /^\d+$/.test(hour) ? `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}` : undefined;
  const days: Record<string, string> = { "1-5": "Weekdays", "0,6": "Weekends", "6,0": "Weekends", "*": "Every day" };
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (dom === "*" && month === "*") {
    if (time && dow in days) return `${days[dow]} at ${time}`;
    if (time && /^[0-6]$/.test(dow)) return `Every ${names[Number(dow)]} at ${time}`;
    const everyHours = /^\*\/(\d+)$/.exec(hour);
    if (minute === "0" && everyHours && dow === "*") return `Every ${everyHours[1]} hours`;
    if (minute === "0" && hour === "*" && dow === "*") return "Every hour";
    const everyMinutes = /^\*\/(\d+)$/.exec(minute);
    if (everyMinutes && hour === "*" && dow === "*") return `Every ${everyMinutes[1]} minutes`;
  }
  if (time && /^\d+$/.test(dom) && month === "*" && dow === "*") return `Monthly on day ${dom} at ${time}`;
  return expression;
}
