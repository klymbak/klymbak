/**
 * Deterministic shipment simulation shared by the carrier MCP server and the store's
 * seed data, so the store's order statuses agree with what the carrier reports.
 *
 * Tracking numbers encode the carrier and the hand-over time:
 *   AC + YYMMDDHH (UTC) + 6 digits + carrier letter, e.g. AC26101314482913U
 */

const HOUR = 3_600_000;
const CARRIER_LETTERS: Record<string, string> = { UPS: "U", FedEx: "F", DHL: "D", USPS: "P" };
const LETTER_CARRIERS = Object.fromEntries(Object.entries(CARRIER_LETTERS).map(([k, v]) => [v, k]));

export type ShipmentStatus = "label_created" | "picked_up" | "in_transit" | "delayed" | "out_for_delivery" | "delivered";

export interface ShipmentEvent {
  at: number;
  status: ShipmentStatus;
  location: string;
  detail: string;
}

export interface ShipmentProgress {
  trackingNumber: string;
  carrier: string;
  status: ShipmentStatus;
  shippedAt: number;
  estimatedDelivery: number;
  deliveredAt?: number;
  delayed: boolean;
  events: ShipmentEvent[];
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function encode(carrier: string, shippedAt: number, serial: number): string {
  const d = new Date(shippedAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${pad(d.getUTCFullYear() % 100)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
  return `AC${stamp}${String(serial % 1_000_000).padStart(6, "0")}${CARRIER_LETTERS[carrier] ?? "U"}`;
}

/**
 * Builds a tracking number. With `accept`, the serial is advanced until the simulated
 * shipment satisfies it (used to script storylines such as "delayed in transit").
 */
export function trackingNumber(
  carrier: string,
  shippedAt: number,
  serial: number,
  accept?: (progress: ShipmentProgress) => boolean,
  now = Date.now(),
): string {
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const candidate = encode(carrier, shippedAt, serial + attempt);
    if (!accept || accept(shipmentProgress(candidate, now)!)) return candidate;
  }
  throw new Error("No tracking number satisfies the requested storyline.");
}

export function parseTrackingNumber(value: string): { carrier: string; shippedAt: number } | undefined {
  const match = /^AC(\d{2})(\d{2})(\d{2})(\d{2})\d{6}([UFDP])$/.exec(value.trim().toUpperCase());
  if (!match) return undefined;
  const [, yy, mm, dd, hh, letter] = match;
  return {
    carrier: LETTER_CARRIERS[letter!]!,
    shippedAt: Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh)),
  };
}

export function shipmentProgress(tracking: string, now = Date.now()): ShipmentProgress | undefined {
  const parsed = parseTrackingNumber(tracking);
  if (!parsed) return undefined;
  const { carrier, shippedAt } = parsed;
  const hash = fnv1a(tracking.toUpperCase());
  const delayed = hash % 100 < 9;
  const transitHours = delayed ? 150 : 48 + (hash % 36);
  const estimatedDelivery = shippedAt + transitHours * HOUR;

  const plan: ShipmentEvent[] = [
    { at: shippedAt, status: "label_created", location: "Acme fulfillment center", detail: "Shipping label created" },
    { at: shippedAt + 3 * HOUR, status: "picked_up", location: "Acme fulfillment center", detail: `Picked up by ${carrier}` },
    { at: shippedAt + 14 * HOUR, status: "in_transit", location: `${carrier} regional hub`, detail: "Departed facility" },
    { at: shippedAt + 30 * HOUR, status: "in_transit", location: "Destination hub", detail: "Arrived at destination facility" },
  ];
  if (delayed) {
    plan.push({ at: shippedAt + 46 * HOUR, status: "delayed", location: "Destination hub", detail: "Delayed: weather disruption at hub. New delivery date pending." });
  }
  plan.push(
    { at: estimatedDelivery - 6 * HOUR, status: "out_for_delivery", location: "Local delivery station", detail: "Out for delivery" },
    { at: estimatedDelivery, status: "delivered", location: "Recipient address", detail: "Delivered, left at front door" },
  );

  const events = plan.filter((event) => event.at <= now);
  const status = events.at(-1)?.status ?? "label_created";
  return {
    trackingNumber: tracking.toUpperCase(),
    carrier,
    status,
    shippedAt,
    estimatedDelivery,
    deliveredAt: status === "delivered" ? estimatedDelivery : undefined,
    delayed,
    events: events.reverse(),
  };
}
