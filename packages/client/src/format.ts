import type { Tone, ValueFormat } from "@klymbak/protocol";
import { createI18n } from "./i18n.ts";

export { configureFormatting } from "./i18n.ts";

// English words with the locale from configureFormatting. Components use their own I18n (see createI18n).
const english = createI18n();

export function timeAgo(value: unknown): string {
  return english.timeAgo(value);
}

/** Formats a cell or stat value for display. Unknown values fall back to String(). */
export function formatValue(value: unknown, format?: ValueFormat, currencyCode?: string): string {
  return english.formatValue(value, format, currencyCode);
}

/** Compact axis labels: 12.5k, 1.2M. */
export function compactNumber(value: number, format?: ValueFormat, currencyCode = "USD"): string {
  return english.compactNumber(value, format, currencyCode);
}

/** Plain-English description of common cron patterns; falls back to the expression. */
export function describeCron(expression: string): string {
  return english.describeCron(expression);
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
