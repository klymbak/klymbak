export const DAY = 86_400_000;

export const usd = (value: unknown) =>
  `$${Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

export const shortDate = (iso: unknown) => (typeof iso === "string" ? iso.slice(0, 10) : "");

/** Order numbers are shown as "#1042"; models sometimes pass them that way. */
export const orderNumber = (value: string | number) => Number(String(value).replace(/[^0-9]/g, ""));

export const ORDER_TONES = {
  pending: "neutral",
  paid: "info",
  shipped: "accent",
  delivered: "success",
  cancelled: "neutral",
  refunded: "danger",
} as const;

export const PRIORITY_TONES = { low: "neutral", normal: "info", high: "warning", urgent: "danger" } as const;

export const SEGMENT_TONES = { new: "info", regular: "neutral", vip: "accent", wholesale: "warning" } as const;

export function like(value: string | undefined) {
  return value ? `%${value.trim()}%` : null;
}
