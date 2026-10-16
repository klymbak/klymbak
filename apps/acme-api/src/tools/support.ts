import { defineTool, StringEnum, Type, ui } from "@klymbak/server";
import { getDb, transaction, type Row } from "../db/database.ts";
import { PRIORITY_TONES, usd } from "./util.ts";

const TICKET_TONES = { open: "warning", pending: "info", closed: "neutral" } as const;

export const listTickets = defineTool({
  name: "list_tickets",
  label: "Support tickets",
  readOnly: true,
  description: "List support tickets, most urgent first. Filter by status, priority or customer email.",
  parameters: Type.Object({
    status: Type.Optional(StringEnum(["open", "pending", "closed"])),
    priority: Type.Optional(StringEnum(["low", "normal", "high", "urgent"])),
    customerEmail: Type.Optional(Type.String()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }),
  execute: ({ status, priority, customerEmail, limit = 25 }) => {
    const rows = getDb()
      .prepare(
        `SELECT t.id, t.subject, t.status, t.priority, t.order_id, t.created_at, c.name AS customer, c.email
         FROM tickets t JOIN customers c ON c.id = t.customer_id
         WHERE (?1 IS NULL OR t.status = ?1) AND (?2 IS NULL OR t.priority = ?2) AND (?3 IS NULL OR lower(c.email) = lower(?3))
         ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                  CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                  t.created_at DESC
         LIMIT ?4`,
      )
      .all(status ?? null, priority ?? null, customerEmail ?? null, limit) as Row[];
    return {
      text: rows.map((t) => `#${t.id} [${t.priority}/${t.status}] "${t.subject}" from ${t.customer} <${t.email}>${t.order_id ? ` re order #${t.order_id}` : ""}`).join("\n") || "No tickets match.",
      ui: ui.table({
        title: "Support tickets",
        rowKey: "id",
        columns: [
          { key: "id", label: "Ticket", format: "code" },
          { key: "subject", label: "Subject" },
          { key: "customer", label: "Customer" },
          { key: "priority", label: "Priority", format: "badge", tones: PRIORITY_TONES },
          { key: "status", label: "Status", format: "badge", tones: TICKET_TONES },
          { key: "created_at", label: "Opened", format: "relative" },
        ],
        rows,
        rowActions: [{ label: "Handle", prompt: "Help me resolve ticket #{id}" }],
      }),
    };
  },
});

export const getTicket = defineTool({
  name: "get_ticket",
  label: "Open ticket",
  readOnly: true,
  description: "Read a support ticket in full: the customer's message, replies so far, and the related order.",
  parameters: Type.Object({ ticketId: Type.Integer() }),
  execute: ({ ticketId }) => {
    const db = getDb();
    const ticket = db
      .prepare(
        `SELECT t.*, c.name AS customer, c.email, c.segment
         FROM tickets t JOIN customers c ON c.id = t.customer_id WHERE t.id = ?`,
      )
      .get(ticketId) as Row | undefined;
    if (!ticket) return { text: `Ticket #${ticketId} does not exist.`, isError: true };
    const replies = db.prepare("SELECT author, body, created_at FROM ticket_replies WHERE ticket_id = ? ORDER BY created_at").all(ticketId) as Row[];
    const order = ticket.order_id
      ? (db.prepare("SELECT id, status, total, carrier, tracking_number FROM orders WHERE id = ?").get(ticket.order_id) as Row | undefined)
      : undefined;
    return {
      text: [
        `Ticket #${ticket.id} [${ticket.priority}/${ticket.status}] "${ticket.subject}", opened ${ticket.created_at}.`,
        `From ${ticket.customer} <${ticket.email}> (${ticket.segment}).`,
        `Message: ${ticket.body}`,
        order ? `Related order #${order.id}: ${order.status}, ${usd(order.total)}${order.tracking_number ? `, ${order.carrier} ${order.tracking_number}` : ""}.` : "",
        replies.length ? `Replies:\n${replies.map((r) => `- ${r.author} (${r.created_at}): ${r.body}`).join("\n")}` : "No replies yet.",
      ].filter(Boolean).join("\n"),
      ui: [
        ui.keyValue(
          [
            { label: "Ticket", value: `#${ticket.id}`, format: "code" },
            { label: "Customer", value: `${ticket.customer} · ${ticket.email}` },
            { label: "Priority", value: ticket.priority, format: "badge", tone: PRIORITY_TONES[ticket.priority as keyof typeof PRIORITY_TONES] },
            { label: "Status", value: ticket.status, format: "badge", tone: TICKET_TONES[ticket.status as keyof typeof TICKET_TONES] },
            { label: "Opened", value: ticket.created_at, format: "relative" },
            ...(order ? [{ label: "Order", value: `#${order.id} · ${order.status} · ${usd(order.total)}` }] : []),
          ],
          String(ticket.subject),
        ),
        ui.markdown(`> ${String(ticket.body).replace(/\n/g, "\n> ")}`),
      ],
    };
  },
});

export const replyToTicket = defineTool({
  name: "reply_to_ticket",
  label: "Reply to customer",
  roles: ["admin", "support"],
  description:
    "Email a reply to the customer on a support ticket and set its status (pending = waiting on customer, closed = resolved). Write in a warm, concise tone and sign as the Acme support team.",
  parameters: Type.Object({
    ticketId: Type.Integer(),
    message: Type.String({ description: "The email body the customer will receive" }),
    status: Type.Optional(StringEnum(["pending", "closed"], { description: "Default pending" })),
  }),
  approval: ({ ticketId, message }) => {
    const ticket = getDb().prepare("SELECT c.name FROM tickets t JOIN customers c ON c.id = t.customer_id WHERE t.id = ?").get(ticketId) as Row | undefined;
    return { title: `Email ${ticket?.name ?? "the customer"} (ticket #${ticketId})`, description: message, risk: "medium" };
  },
  execute: ({ ticketId, message, status = "pending" }, ctx) => {
    const ticket = getDb().prepare("SELECT id FROM tickets WHERE id = ?").get(ticketId) as Row | undefined;
    if (!ticket) return { text: `Ticket #${ticketId} does not exist.`, isError: true };
    const now = new Date().toISOString();
    transaction((db) => {
      db.prepare("INSERT INTO ticket_replies (ticket_id, author, body, created_at) VALUES (?, ?, ?, ?)").run(ticketId, ctx.user.name, message, now);
      db.prepare("UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?").run(status, now, ticketId);
    });
    return `Reply sent on ticket #${ticketId}; status is now ${status}.`;
  },
});
