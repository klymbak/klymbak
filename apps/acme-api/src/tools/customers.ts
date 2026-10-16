import { defineTool, StringEnum, Type, ui } from "@klymbak/server";
import { getDb, type Row } from "../db/database.ts";
import { like, ORDER_TONES, PRIORITY_TONES, SEGMENT_TONES, shortDate, usd } from "./util.ts";

export const searchCustomers = defineTool({
  name: "search_customers",
  label: "Search customers",
  readOnly: true,
  description:
    "Find customers by part of their name, email or city, and/or by country or segment. Returns order count and lifetime spend, sorted by spend.",
  parameters: Type.Object({
    query: Type.Optional(Type.String({ description: "Part of a name, email or city" })),
    country: Type.Optional(Type.String({ description: "ISO country code: US, CA, UK, DE, FR, NL, SE, AU" })),
    segment: Type.Optional(StringEnum(["new", "regular", "vip", "wholesale"])),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, description: "Default 20" })),
  }),
  execute: ({ query, country, segment, limit = 20 }) => {
    const pattern = like(query);
    const rows = getDb()
      .prepare(
        `SELECT c.id, c.name, c.email, c.city, c.country, c.segment,
                COUNT(o.id) AS orders,
                COALESCE(SUM(CASE WHEN o.status NOT IN ('cancelled', 'refunded') THEN o.total END), 0) AS lifetime_value,
                MAX(o.created_at) AS last_order
         FROM customers c LEFT JOIN orders o ON o.customer_id = c.id
         WHERE (?1 IS NULL OR c.name LIKE ?1 OR c.email LIKE ?1 OR c.city LIKE ?1)
           AND (?2 IS NULL OR c.country = upper(?2))
           AND (?3 IS NULL OR c.segment = ?3)
         GROUP BY c.id ORDER BY lifetime_value DESC LIMIT ?4`,
      )
      .all(pattern, country ?? null, segment ?? null, limit) as Row[];

    return {
      text: rows.length
        ? rows.map((r) => `#${r.id} ${r.name} <${r.email}> ${r.city}, ${r.country} · ${r.segment} · ${r.orders} orders · ${usd(r.lifetime_value)}`).join("\n")
        : "No customers match.",
      ui: ui.table({
        title: `Customers${query ? ` matching "${query}"` : ""}`,
        rowKey: "email",
        columns: [
          { key: "name", label: "Customer" },
          { key: "email", label: "Email", format: "email" },
          { key: "location", label: "Location" },
          { key: "segment", label: "Segment", format: "badge", tones: SEGMENT_TONES },
          { key: "orders", label: "Orders", format: "integer", align: "right" },
          { key: "lifetime_value", label: "Lifetime spend", format: "currency", align: "right" },
          { key: "last_order", label: "Last order", format: "relative" },
        ],
        rows: rows.map((r) => ({ ...r, location: `${r.city}, ${r.country}` })),
        rowActions: [{ label: "Open profile", prompt: "Show me the profile of customer {email}" }],
      }),
    };
  },
});

export const getCustomer = defineTool({
  name: "get_customer",
  label: "Customer profile",
  readOnly: true,
  description: "Full profile of one customer by id or email: contact details, spend, recent orders and support tickets.",
  parameters: Type.Object({
    id: Type.Optional(Type.Integer()),
    email: Type.Optional(Type.String()),
  }),
  execute: ({ id, email }) => {
    const db = getDb();
    const customer = db
      .prepare("SELECT * FROM customers WHERE id = ? OR lower(email) = lower(?)")
      .get(id ?? -1, email ?? "") as Row | undefined;
    if (!customer) return { text: `No customer found for ${email ?? `id ${id}`}.`, isError: true };

    const stats = db
      .prepare(
        `SELECT COUNT(*) AS orders,
                COALESCE(SUM(CASE WHEN status NOT IN ('cancelled','refunded') THEN total END), 0) AS spend,
                COALESCE(AVG(total), 0) AS aov
         FROM orders WHERE customer_id = ?`,
      )
      .get(customer.id) as Row;
    const refunded = (db.prepare("SELECT COALESCE(SUM(r.amount), 0) AS total FROM refunds r JOIN orders o ON o.id = r.order_id WHERE o.customer_id = ?").get(customer.id) as Row).total;
    const orders = db
      .prepare(
        `SELECT o.id, o.status, o.total, o.created_at, o.carrier, o.tracking_number,
                (SELECT group_concat(p.name, ', ') FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = o.id) AS items
         FROM orders o WHERE o.customer_id = ? ORDER BY o.created_at DESC LIMIT 8`,
      )
      .all(customer.id) as Row[];
    const tickets = db
      .prepare("SELECT id, subject, status, priority, order_id, created_at FROM tickets WHERE customer_id = ? ORDER BY created_at DESC LIMIT 5")
      .all(customer.id) as Row[];

    const text = [
      `${customer.name} (#${customer.id}) <${customer.email}>, ${customer.phone}, ${customer.city}, ${customer.country}. Segment: ${customer.segment}. Customer since ${shortDate(customer.created_at)}.`,
      `${stats.orders} orders, lifetime spend ${usd(stats.spend)}, average order ${usd(stats.aov)}, refunded ${usd(refunded)}.`,
      `Recent orders: ${orders.map((o) => `#${o.id} ${o.status} ${usd(o.total)} on ${shortDate(o.created_at)} (${o.items})${o.tracking_number ? ` tracking ${o.tracking_number}` : ""}`).join("; ") || "none"}.`,
      `Tickets: ${tickets.map((t) => `#${t.id} "${t.subject}" ${t.status}/${t.priority}${t.order_id ? ` re order #${t.order_id}` : ""}`).join("; ") || "none"}.`,
    ].join("\n");

    return {
      text,
      ui: [
        ui.keyValue(
          [
            { label: "Customer", value: customer.name },
            { label: "Email", value: customer.email, format: "email" },
            { label: "Phone", value: customer.phone },
            { label: "Location", value: `${customer.city}, ${customer.country}` },
            { label: "Segment", value: customer.segment, format: "badge", tone: SEGMENT_TONES[customer.segment as keyof typeof SEGMENT_TONES] },
            { label: "Customer since", value: customer.created_at, format: "date" },
          ],
          "Profile",
        ),
        ui.stats([
          { label: "Orders", value: Number(stats.orders), format: "integer" },
          { label: "Lifetime spend", value: Number(stats.spend), format: "currency" },
          { label: "Average order", value: Number(stats.aov), format: "currency" },
          { label: "Refunded", value: Number(refunded), format: "currency", tone: Number(refunded) > 0 ? "warning" : undefined },
        ]),
        ui.table({
          title: "Recent orders",
          rowKey: "id",
          columns: [
            { key: "id", label: "Order", format: "code" },
            { key: "created_at", label: "Placed", format: "date" },
            { key: "items", label: "Items" },
            { key: "status", label: "Status", format: "badge", tones: ORDER_TONES },
            { key: "total", label: "Total", format: "currency", align: "right" },
          ],
          rows: orders,
          rowActions: [{ label: "Details", prompt: "Show order #{id}" }],
        }),
        ...(tickets.length
          ? [
              ui.table({
                title: "Support tickets",
                rowKey: "id",
                columns: [
                  { key: "id", label: "Ticket", format: "code" },
                  { key: "subject", label: "Subject" },
                  { key: "priority", label: "Priority", format: "badge", tones: PRIORITY_TONES },
                  { key: "status", label: "Status", format: "badge", tones: { open: "warning", pending: "info", closed: "neutral" } },
                  { key: "created_at", label: "Opened", format: "relative" },
                ],
                rows: tickets,
                rowActions: [{ label: "Handle", prompt: "Help me resolve ticket #{id}" }],
              }),
            ]
          : []),
      ],
    };
  },
});
