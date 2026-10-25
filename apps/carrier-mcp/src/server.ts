#!/usr/bin/env node
/**
 * "ParcelPoint" carrier API as an MCP server.
 *
 * Any MCP client can use it (Claude Desktop, Cursor, or the Acme back-office agent),
 * which is the point: integrations written once as MCP servers plug into any agent.
 */
import { DatabaseSync } from "node:sqlite";
import { completable } from "@modelcontextprotocol/sdk/server/completable.js";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { shipmentProgress, type ShipmentProgress } from "./rules.ts";

const server = new McpServer({ name: "parcelpoint-carrier", version: "1.0.0" });

const ZONES: Record<string, number> = { US: 1, CA: 1, UK: 2, DE: 2, FR: 2, NL: 2, SE: 2, AU: 3 };

/** A shipment's status and scan history, as text. */
function describeShipment(progress: ShipmentProgress): string {
  const fmt = (t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC";
  return [
    `${progress.carrier} ${progress.trackingNumber}: ${progress.status.replace(/_/g, " ")}`,
    progress.deliveredAt ? `Delivered ${fmt(progress.deliveredAt)}` : `Estimated delivery ${fmt(progress.estimatedDelivery)}${progress.delayed ? " (delayed, may slip)" : ""}`,
    "History:",
    ...progress.events.map((e) => `- ${fmt(e.at)} · ${e.location} · ${e.detail}`),
  ].join("\n");
}

/**
 * Tracking numbers of the account's shipments that start with what's typed, newest first, to suggest as people type.
 * A real carrier lists an account's shipments through its API; in the demo the store passes its database
 * (CARRIER_SHIPMENTS_DB), read here read-only.
 */
function suggestTrackingNumbers(typed: string): string[] {
  const path = process.env.CARRIER_SHIPMENTS_DB;
  if (!path) return [];
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const rows = db
        .prepare("SELECT tracking_number FROM orders WHERE tracking_number LIKE ? ORDER BY shipped_at DESC LIMIT 20")
        .all(`${typed.trim().toUpperCase()}%`) as { tracking_number: string }[];
      return rows.map((row) => row.tracking_number);
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

server.registerTool(
  "track_shipment",
  {
    title: "Track shipment",
    description:
      "Get the live status and scan history of a parcel by tracking number (format AC + 14 digits + carrier letter, e.g. AC26101314482913U).",
    inputSchema: { trackingNumber: z.string().describe("Tracking number from the order") },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ trackingNumber }) => {
    const progress = shipmentProgress(trackingNumber);
    if (!progress) {
      return { isError: true, content: [{ type: "text", text: `No shipment found for tracking number ${trackingNumber}.` }] };
    }
    return {
      content: [{ type: "text", text: describeShipment(progress) }],
      structuredContent: {
        status: progress.status,
        carrier: progress.carrier,
        estimatedDelivery: new Date(progress.estimatedDelivery).toISOString(),
        events: progress.events.map((e) => ({ time: new Date(e.at).toISOString(), location: e.location, detail: e.detail })),
      },
    };
  },
);

server.registerTool(
  "get_shipping_quote",
  {
    title: "Get shipping quote",
    description: "Compare carrier rates and transit times for a parcel between two countries (ISO codes like US, DE, UK).",
    inputSchema: {
      fromCountry: z.string().length(2),
      toCountry: z.string().length(2),
      weightKg: z.number().positive().max(70),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ fromCountry, toCountry, weightKg }) => {
    const distance = Math.abs((ZONES[fromCountry.toUpperCase()] ?? 2) - (ZONES[toCountry.toUpperCase()] ?? 2));
    const domestic = fromCountry.toUpperCase() === toCountry.toUpperCase();
    const services = [
      { carrier: "USPS", service: "Ground Advantage", base: 6.4, perKg: 1.9, days: 5, domesticOnly: true },
      { carrier: "UPS", service: "Ground", base: 8.9, perKg: 2.1, days: 4 },
      { carrier: "FedEx", service: "Express Saver", base: 14.5, perKg: 3.4, days: 2 },
      { carrier: "DHL", service: "Express Worldwide", base: 24, perKg: 5.2, days: 3 },
    ].filter((s) => domestic || !s.domesticOnly);
    const quotes = services.map((s) => ({
      carrier: s.carrier,
      service: s.service,
      priceUsd: Math.round((s.base + s.perKg * weightKg) * (1 + distance * 0.6 + (domestic ? 0 : 0.4)) * 100) / 100,
      transitDays: s.days + distance * 2 + (domestic ? 0 : 1),
    }));
    return {
      content: [
        {
          type: "text",
          text: quotes.map((q) => `${q.carrier} ${q.service}: $${q.priceUsd.toFixed(2)}, ${q.transitDays} days`).join("\n"),
        },
      ],
      structuredContent: { quotes },
    };
  },
);

server.registerTool(
  "create_return_label",
  {
    title: "Create return label",
    description: "Create a prepaid return label for an order and email it to the customer. The store pays the return postage.",
    inputSchema: {
      orderId: z.number().int().describe("Store order number"),
      customerEmail: z.string().email(),
      reason: z.string(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  async ({ orderId, customerEmail, reason }) => {
    const label = `RTN-${orderId}-${Date.now().toString(36).toUpperCase().slice(-5)}`;
    return {
      content: [
        {
          type: "text",
          text: `Return label ${label} created for order #${orderId} (${reason}) and emailed to ${customerEmail}. Drop-off at any UPS location within 14 days.`,
        },
      ],
      structuredContent: { label, orderId, emailedTo: customerEmail, expiresInDays: 14 },
    };
  },
);

// Resources: reference documents people can mention in the chat with @.

server.registerResource(
  "return-policy",
  "parcelpoint://policies/returns",
  { title: "Return policy", description: "Who pays for returns, how long labels last and where parcels go", mimeType: "text/markdown" },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: [
          "# ParcelPoint return policy",
          "",
          "- The store pays return postage on every prepaid label it creates.",
          "- A return label is valid for 14 days and can be dropped off at any UPS location.",
          "- Returns are scanned at the store's warehouse within 2 business days of arrival.",
          "- A parcel lost on its way back is the carrier's responsibility once it has a drop-off scan.",
          "- Oversize items (over 30 kg or 150 cm) need a pickup instead of a label.",
        ].join("\n"),
      },
    ],
  }),
);

server.registerResource(
  "service-levels",
  "parcelpoint://service-levels",
  { title: "Service levels", description: "Carriers, services and transit times by zone", mimeType: "text/markdown" },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/markdown",
        text: [
          "| Carrier | Service | Domestic transit | Per extra zone | Notes |",
          "|---|---|---|---|---|",
          "| USPS | Ground Advantage | 5 days | n/a | Domestic only |",
          "| UPS | Ground | 4 days | +2 days | |",
          "| FedEx | Express Saver | 2 days | +2 days | |",
          "| DHL | Express Worldwide | 3 days | +2 days | Best for zone 3 |",
          "",
          `Zones: ${Object.entries(ZONES)
            .map(([country, zone]) => `${country} ${zone}`)
            .join(", ")}. International parcels take one more day.`,
        ].join("\n"),
      },
    ],
  }),
);

server.registerResource(
  "shipment",
  new ResourceTemplate("parcelpoint://shipments/{trackingNumber}", { list: undefined, complete: { trackingNumber: suggestTrackingNumbers } }),
  { title: "Shipment", description: "A parcel's status and scan history, by tracking number", mimeType: "text/markdown" },
  async (uri, { trackingNumber }) => {
    const progress = shipmentProgress(String(trackingNumber));
    if (!progress) throw new Error(`No shipment found for tracking number ${trackingNumber}.`);
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: describeShipment(progress) }] };
  },
);

// Prompts: tasks people start from the chat with /.

server.registerPrompt(
  "delay_notice",
  {
    title: "Delay notice",
    description: "Draft an email to a customer whose parcel is late",
    argsSchema: {
      trackingNumber: completable(z.string().describe("Tracking number of the late parcel"), suggestTrackingNumbers),
      tone: z.string().optional().describe("friendly or formal"),
    },
  },
  ({ trackingNumber, tone }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `The parcel ${trackingNumber} is late. Look it up with track_shipment, then draft a short, ${tone || "friendly"} email to the customer: apologize, give the new estimated delivery and say what happens if it slips again. Don't promise compensation in the email; if the delay is over 3 days, suggest one to me separately.`,
        },
      },
    ],
  }),
);

server.registerPrompt(
  "compare_rates",
  {
    title: "Compare shipping rates",
    description: "Find the cheapest carrier that delivers within 5 days",
    argsSchema: {
      fromCountry: z.string().describe("ISO code, e.g. US"),
      toCountry: z.string().describe("ISO code, e.g. DE"),
      weightKg: z.string().describe("Weight in kg"),
    },
  },
  ({ fromCountry, toCountry, weightKg }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `Compare carrier rates for a ${weightKg} kg parcel from ${fromCountry} to ${toCountry} with get_shipping_quote, and recommend the cheapest option that arrives within 5 days.`,
        },
      },
    ],
  }),
);

await server.connect(new StdioServerTransport());
console.error("ParcelPoint carrier MCP server ready on stdio");
