import { auditTrail, redactPii, type Hook } from "@klymbak/server";
import { audit, getDb, type Row } from "./db/database.ts";
import { orderNumber, usd } from "./tools/util.ts";

/** Refund rules that used to live in the admin panel's permission matrix. */
export const refundPolicy: Hook = {
  name: "refund-policy",
  tools: ["refund_order"],
  preToolUse: ({ args, ctx }) => {
    const order = getDb()
      .prepare("SELECT total - COALESCE((SELECT SUM(amount) FROM refunds WHERE order_id = orders.id), 0) AS balance FROM orders WHERE id = ?")
      .get(orderNumber(args.orderId)) as Row | undefined;
    if (!order) return;
    const amount = Number(args.amount ?? order.balance);
    if (amount > 1000) {
      return { decision: "deny", reason: `Refunds over $1,000 (this one is ${usd(amount)}) go through finance. Open a finance ticket instead.` };
    }
    if (!ctx.user.roles.includes("admin") && amount > 150) {
      return { decision: "deny", reason: `Support staff can refund up to $150; this is ${usd(amount)}. Ask an admin to approve it.` };
    }
    if (amount <= 25 && !ctx.headless) return { decision: "allow" };
  },
};

/** Gives every new conversation a live snapshot of the business, like a dashboard header. */
export const businessSnapshot: Hook = {
  name: "business-snapshot",
  sessionStart: () => {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const sales = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS revenue FROM orders WHERE created_at >= ? AND status != 'cancelled'").get(today) as Row;
    const toShip = (db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status IN ('pending', 'paid')").get() as Row).n;
    const tickets = db.prepare("SELECT COUNT(*) AS open, SUM(priority = 'urgent') AS urgent FROM tickets WHERE status = 'open'").get() as Row;
    const stock = db.prepare("SELECT SUM(stock <= reorder_level) AS low, SUM(stock = 0) AS out FROM products WHERE active = 1").get() as Row;
    return {
      context: `## Business snapshot (when this conversation started)
Orders today: ${sales.n} (${usd(sales.revenue)}). Waiting to ship: ${toShip}. Open tickets: ${tickets.open} (${tickets.urgent ?? 0} urgent). Products at or below reorder level: ${stock.low} (${stock.out} out of stock).`,
    };
  },
};

/** Every change made through the agent lands in the audit log, attributed to the person. */
export const auditLog = auditTrail((entry) => {
  audit(entry.user.name, entry.tool, JSON.stringify(entry.args), entry.unattended ? "schedule" : "chat");
});

/** Analysts work with aggregates; they never see customer contact details. */
export const analystPrivacy = redactPii({ roles: ["analyst"] });

/** Console telemetry: one line per run with tokens and cost. */
export const runTelemetry: Hook = {
  name: "telemetry",
  runEnd: ({ status, usage, ctx }) => {
    const cost = usage.cost ? ` · $${usage.cost.toFixed(4)}` : "";
    console.log(`[run] ${ctx.user.name} · ${ctx.sessionId} · ${status} · ${usage.totalTokens} tokens${cost}${ctx.headless ? " · scheduled" : ""}`);
  },
};

export const hooks = [refundPolicy, businessSnapshot, auditLog, analystPrivacy, runTelemetry];
