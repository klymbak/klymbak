#!/usr/bin/env node
/**
 * "ParcelPoint" carrier API as an MCP server.
 *
 * Any MCP client can use it (Claude Desktop, Cursor, or the Acme back-office agent),
 * which is the point: integrations written once as MCP servers plug into any agent.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { shipmentProgress } from "./rules.ts";

const server = new McpServer({ name: "parcelpoint-carrier", version: "1.0.0" });

const ZONES: Record<string, number> = { US: 1, CA: 1, UK: 2, DE: 2, FR: 2, NL: 2, SE: 2, AU: 3 };

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
    const fmt = (t: number) => new Date(t).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    const lines = [
      `${progress.carrier} ${progress.trackingNumber}: ${progress.status.replace(/_/g, " ")}`,
      progress.deliveredAt ? `Delivered ${fmt(progress.deliveredAt)}` : `Estimated delivery ${fmt(progress.estimatedDelivery)}${progress.delayed ? " (delayed, may slip)" : ""}`,
      "History:",
      ...progress.events.map((e) => `- ${fmt(e.at)} · ${e.location} · ${e.detail}`),
    ];
    return {
      content: [{ type: "text", text: lines.join("\n") }],
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

await server.connect(new StdioServerTransport());
console.error("ParcelPoint carrier MCP server ready on stdio");
