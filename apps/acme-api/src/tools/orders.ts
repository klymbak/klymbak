import { defineTool, StringEnum, Type, ui } from "@klymbak/server";
import { trackingNumber } from "carrier-mcp/rules";
import { getDb, transaction, type Row } from "../db/database.ts";
import { isoDaysAgo, ORDER_TONES, orderNumber, shortDate, usd } from "./util.ts";

const STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled", "refunded"] as const;

export const listOrders = defineTool({
  name: "list_orders",
  label: "List orders",
  readOnly: true,
  description:
    "Search orders by status, customer, date range, country or minimum total. Newest first unless sort is 'largest'.",
  parameters: Type.Object({
    status: Type.Optional(StringEnum(STATUSES)),
    customerEmail: Type.Optional(Type.String()),
    customerId: Type.Optional(Type.Integer()),
    sinceDays: Type.Optional(Type.Number({ description: "Only orders placed in the last N days" })),
    country: Type.Optional(Type.String({ description: "Shipping country, ISO code" })),
    minTotal: Type.Optional(Type.Number()),
    sort: Type.Optional(StringEnum(["newest", "largest"])),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200, description: "Default 25" })),
  }),
  execute: (args) => {
    const where = ["1 = 1"];
    const params: (string | number)[] = [];
    if (args.status) where.push("o.status = ?"), params.push(args.status);
    if (args.customerEmail) where.push("lower(c.email) = lower(?)"), params.push(args.customerEmail);
    if (args.customerId) where.push("c.id = ?"), params.push(args.customerId);
    if (args.sinceDays) where.push("o.created_at >= ?"), params.push(isoDaysAgo(args.sinceDays));
    if (args.country) where.push("o.shipping_country = upper(?)"), params.push(args.country);
    if (args.minTotal) where.push("o.total >= ?"), params.push(args.minTotal);
    const order = args.sort === "largest" ? "o.total DESC" : "o.created_at DESC";
    const db = getDb();
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM orders o JOIN customers c ON c.id = o.customer_id WHERE ${where.join(" AND ")}`).get(...params) as Row).n as number;
    const rows = db
      .prepare(
        `SELECT o.id, o.status, o.total, o.channel, o.shipping_country, o.created_at, c.name AS customer, c.email
         FROM orders o JOIN customers c ON c.id = o.customer_id
         WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`,
      )
      .all(...params, args.limit ?? 25) as Row[];

    return {
      text:
        `${total} orders match${total > rows.length ? ` (showing ${rows.length})` : ""}.\n` +
        rows.map((r) => `#${r.id} ${shortDate(r.created_at)} ${r.customer} ${r.status} ${usd(r.total)} ${r.channel} ${r.shipping_country}`).join("\n"),
      ui: ui.table({
        title: "Orders",
        totalRows: total,
        rowKey: "id",
        columns: [
          { key: "id", label: "Order", format: "code" },
          { key: "created_at", label: "Placed", format: "datetime" },
          { key: "customer", label: "Customer" },
          { key: "status", label: "Status", format: "badge", tones: ORDER_TONES },
          { key: "channel", label: "Channel" },
          { key: "shipping_country", label: "Ship to" },
          { key: "total", label: "Total", format: "currency", align: "right" },
        ],
        rows,
        rowActions: [{ label: "Details", prompt: "Show order #{id}" }],
      }),
    };
  },
});

function loadOrder(id: number) {
  const db = getDb();
  const order = db
    .prepare(
      `SELECT o.*, c.name AS customer, c.email, c.segment
       FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?`,
    )
    .get(id) as Row | undefined;
  if (!order) return undefined;
  const items = db
    .prepare(
      `SELECT p.sku, p.name, i.quantity, i.unit_price, i.quantity * i.unit_price AS line_total
       FROM order_items i JOIN products p ON p.id = i.product_id WHERE i.order_id = ?`,
    )
    .all(id) as Row[];
  const refunds = db.prepare("SELECT amount, reason, created_by, created_at FROM refunds WHERE order_id = ?").all(id) as Row[];
  const refunded = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
  return { order, items, refunds, refunded };
}

export const getOrder = defineTool({
  name: "get_order",
  label: "Order details",
  readOnly: true,
  description: "Everything about one order: customer, items, totals, shipping and tracking, refunds.",
  parameters: Type.Object({ orderId: Type.Union([Type.Integer(), Type.String()], { description: "Order number, e.g. 1042" }) }),
  execute: ({ orderId }) => {
    const id = orderNumber(orderId);
    const found = loadOrder(id);
    if (!found) return { text: `Order #${id} does not exist.`, isError: true };
    const { order, items, refunds, refunded } = found;
    const text = [
      `Order #${id} · ${order.status} · placed ${order.created_at} via ${order.channel}.`,
      `Customer: ${order.customer} <${order.email}> (${order.segment}). Ships to ${order.shipping_country}.`,
      `Items: ${items.map((i) => `${i.quantity}× ${i.name} (${i.sku}) @ ${usd(i.unit_price)}`).join("; ")}.`,
      `Subtotal ${usd(order.subtotal)}, shipping ${usd(order.shipping)}, discount ${usd(order.discount)}${order.discount_code ? ` (${order.discount_code})` : ""}, total ${usd(order.total)}.`,
      order.tracking_number ? `Shipping: ${order.carrier} ${order.tracking_number}, shipped ${order.shipped_at}${order.delivered_at ? `, delivered ${order.delivered_at}` : ""}.` : "Not shipped yet.",
      refunds.length ? `Refunds: ${refunds.map((r) => `${usd(r.amount)} (${r.reason}) by ${r.created_by}`).join("; ")}. Refundable balance ${usd(Number(order.total) - refunded)}.` : `No refunds. Refundable balance ${usd(order.total)}.`,
    ].join("\n");

    return {
      text,
      ui: [
        ui.keyValue(
          [
            { label: "Order", value: `#${id}`, format: "code" },
            { label: "Status", value: order.status, format: "badge", tone: ORDER_TONES[order.status as keyof typeof ORDER_TONES] },
            { label: "Customer", value: `${order.customer} · ${order.email}` },
            { label: "Placed", value: order.created_at, format: "datetime" },
            { label: "Total", value: order.total, format: "currency" },
            { label: "Carrier", value: order.tracking_number ? `${order.carrier} · ${order.tracking_number}` : "Not shipped" },
            ...(refunded ? [{ label: "Refunded", value: refunded, format: "currency" as const, tone: "danger" as const }] : []),
          ],
          `Order #${id}`,
        ),
        ui.table({
          title: "Items",
          columns: [
            { key: "name", label: "Product" },
            { key: "sku", label: "SKU", format: "code" },
            { key: "quantity", label: "Qty", format: "integer", align: "right" },
            { key: "unit_price", label: "Price", format: "currency", align: "right" },
            { key: "line_total", label: "Line total", format: "currency", align: "right" },
          ],
          rows: items,
        }),
        ui.actions([
          ...(order.tracking_number ? [{ label: "Track shipment", prompt: `Track the shipment for order #${id}` }] : []),
          ...(["delivered", "shipped"].includes(String(order.status)) ? [{ label: "Refund…", prompt: `Refund order #${id}` }] : []),
          { label: "Customer profile", prompt: `Show me the profile of customer ${order.email}` },
        ]),
      ],
    };
  },
});

export const refundOrder = defineTool({
  name: "refund_order",
  label: "Refund order",
  description:
    "Refund all or part of an order to the customer's original payment method. Omit amount for a full refund of the remaining balance. Limits and approvals are enforced automatically.",
  parameters: Type.Object({
    orderId: Type.Union([Type.Integer(), Type.String()]),
    amount: Type.Optional(Type.Number({ exclusiveMinimum: 0, description: "USD. Omit for the full remaining balance." })),
    reason: Type.String({ description: "Short reason, shown to finance" }),
  }),
  approval: ({ orderId, amount, reason }) => {
    const found = loadOrder(orderNumber(orderId));
    if (!found) return true;
    const value = amount ?? Number(found.order.total) - found.refunded;
    return {
      title: `Refund ${usd(value)} to ${found.order.customer}`,
      description: `Order #${found.order.id} (${found.items.map((i) => i.name).join(", ")}). Reason: ${reason}`,
      risk: value > 200 ? "high" : "medium",
    };
  },
  execute: ({ orderId, amount, reason }, ctx) => {
    const id = orderNumber(orderId);
    const found = loadOrder(id);
    if (!found) return { text: `Order #${id} does not exist.`, isError: true };
    const { order, refunded } = found;
    if (["pending", "cancelled"].includes(String(order.status))) {
      return { text: `Order #${id} is ${order.status}; cancel it instead of refunding.`, isError: true };
    }
    const balance = Math.round((Number(order.total) - refunded) * 100) / 100;
    const value = Math.round((amount ?? balance) * 100) / 100;
    if (balance <= 0) return { text: `Order #${id} is already fully refunded.`, isError: true };
    if (value > balance) return { text: `Only ${usd(balance)} of order #${id} can still be refunded.`, isError: true };

    transaction((db) => {
      db.prepare("INSERT INTO refunds (order_id, amount, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(id, value, reason, ctx.user.name, new Date().toISOString());
      if (value === balance) db.prepare("UPDATE orders SET status = 'refunded' WHERE id = ?").run(id);
    });
    const full = value === balance;
    return {
      text: `Refunded ${usd(value)} on order #${id} to ${order.customer}${full ? " (order now fully refunded)" : `; ${usd(balance - value)} remains refundable`}. The customer gets an automatic email.`,
      ui: ui.alert("success", `${usd(value)} refunded to ${order.customer} for order #${id}. Reason: ${reason}.`, "Refund issued"),
    };
  },
});

const TRANSITIONS: Record<string, string[]> = {
  pending: ["paid", "cancelled"],
  paid: ["shipped", "cancelled"],
  shipped: ["delivered"],
};

export const updateOrderStatus = defineTool({
  name: "update_order_status",
  label: "Update order status",
  description:
    "Move an order through fulfilment: pending → paid → shipped → delivered, or cancel an unshipped order. Shipping assigns a carrier and tracking number. Use refund_order for refunds.",
  parameters: Type.Object({
    orderId: Type.Union([Type.Integer(), Type.String()]),
    status: StringEnum(["paid", "shipped", "delivered", "cancelled"]),
    carrier: Type.Optional(StringEnum(["UPS", "FedEx", "DHL", "USPS"], { description: "When shipping. Default UPS." })),
    note: Type.Optional(Type.String()),
  }),
  approval: ({ orderId, status }) => ({
    title: `Mark order #${orderNumber(orderId)} as ${status}`,
    risk: status === "cancelled" ? "high" : "low",
  }),
  execute: ({ orderId, status, carrier, note }) => {
    const id = orderNumber(orderId);
    const db = getDb();
    const order = db.prepare("SELECT status FROM orders WHERE id = ?").get(id) as Row | undefined;
    if (!order) return { text: `Order #${id} does not exist.`, isError: true };
    const allowed = TRANSITIONS[String(order.status)] ?? [];
    if (!allowed.includes(status)) {
      return { text: `Order #${id} is ${order.status}; it can move to ${allowed.join(" or ") || "no other status"}.`, isError: true };
    }
    const now = new Date();
    if (status === "shipped") {
      const chosen = carrier ?? "UPS";
      const tracking = trackingNumber(chosen, now.getTime(), Math.floor(Math.random() * 1_000_000));
      db.prepare("UPDATE orders SET status = 'shipped', carrier = ?, tracking_number = ?, shipped_at = ? WHERE id = ?").run(chosen, tracking, now.toISOString(), id);
      return `Order #${id} marked shipped with ${chosen}, tracking ${tracking}.${note ? ` Note: ${note}` : ""}`;
    }
    db.prepare(`UPDATE orders SET status = ?${status === "delivered" ? ", delivered_at = ?" : ""} WHERE id = ?`).run(
      ...(status === "delivered" ? [status, now.toISOString(), id] : [status, id]),
    );
    return `Order #${id} is now ${status}.${note ? ` Note: ${note}` : ""}`;
  },
});
