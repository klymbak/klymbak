import { autoTable, defineTool, StringEnum, Type, ui } from "@klymbak/server";
import { getDb, getReadonlyDb, SCHEMA_SUMMARY, type Row } from "../db/database.ts";
import { DAY, usd } from "./util.ts";

const GROUPS = ["day", "week", "category", "channel", "country"] as const;

function periodTotals(fromIso: string, toIso: string) {
  const db = getDb();
  const sales = db
    .prepare(
      `SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS revenue
       FROM orders WHERE created_at >= ? AND created_at < ? AND status != 'cancelled'`,
    )
    .get(fromIso, toIso) as Row;
  const refunds = db.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM refunds WHERE created_at >= ? AND created_at < ?").get(fromIso, toIso) as Row;
  const orders = Number(sales.orders);
  const revenue = Number(sales.revenue);
  return { orders, revenue, aov: orders ? revenue / orders : 0, refunds: Number(refunds.amount) };
}

const change = (current: number, previous: number) => (previous ? (current - previous) / previous : undefined);

export const salesReport = defineTool({
  name: "sales_report",
  label: "Sales report",
  readOnly: true,
  description:
    "Revenue, order count, average order value and refunds for the last N days, compared with the N days before, broken down by day, week, category, channel or country. Use this for any 'how are sales' question before writing SQL.",
  parameters: Type.Object({
    days: Type.Optional(Type.Integer({ minimum: 1, maximum: 120, description: "Length of the period. Default 30." })),
    groupBy: Type.Optional(StringEnum(GROUPS, { description: "Default day" })),
  }),
  execute: ({ days = 30, groupBy = "day" }) => {
    const now = Date.now();
    const from = new Date(now - days * DAY).toISOString();
    const prevFrom = new Date(now - 2 * days * DAY).toISOString();
    const to = new Date(now + 60_000).toISOString();
    const current = periodTotals(from, to);
    const previous = periodTotals(prevFrom, from);

    const db = getDb();
    let breakdown: Row[];
    if (groupBy === "category") {
      breakdown = db
        .prepare(
          `SELECT p.category AS label, ROUND(SUM(i.quantity * i.unit_price), 2) AS revenue, SUM(i.quantity) AS units
           FROM order_items i JOIN orders o ON o.id = i.order_id JOIN products p ON p.id = i.product_id
           WHERE o.created_at >= ? AND o.status != 'cancelled' GROUP BY p.category ORDER BY revenue DESC`,
        )
        .all(from) as Row[];
    } else {
      const key = {
        day: "substr(created_at, 1, 10)",
        week: "strftime('%Y-W%W', created_at)",
        channel: "channel",
        country: "shipping_country",
      }[groupBy];
      const order = groupBy === "day" || groupBy === "week" ? "label" : "revenue DESC";
      breakdown = db
        .prepare(
          `SELECT ${key} AS label, ROUND(SUM(total), 2) AS revenue, COUNT(*) AS orders
           FROM orders WHERE created_at >= ? AND status != 'cancelled' GROUP BY label ORDER BY ${order}`,
        )
        .all(from) as Row[];
    }

    const timeSeries = groupBy === "day" || groupBy === "week";
    const pct = (value: number | undefined) => (value === undefined ? "n/a" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`);
    const day = (iso: string) => iso.slice(0, 10);
    // The newest bucket of a time series is still in progress. Saying so stops models
    // from comparing a partial week with a full one.
    const points = breakdown.map((r, i) => {
      const partial = timeSeries && i === breakdown.length - 1 ? " (in progress)" : "";
      const volume = r.orders !== undefined ? `${r.orders} orders` : `${r.units} units`;
      return `${r.label}${partial}: ${usd(r.revenue)}, ${volume}`;
    });

    // Long time series are summarized for the model: the user already sees every point
    // in the chart, and a model handed 30 rows tends to recite them.
    const ranked = [...breakdown].sort((a, b) => Number(b.revenue) - Number(a.revenue));
    const series =
      timeSeries && points.length > 8
        ? [
            `Best ${groupBy}: ${ranked[0]!.label} (${usd(ranked[0]!.revenue)}); weakest: ${ranked.at(-1)!.label} (${usd(ranked.at(-1)!.revenue)}).`,
            `Most recent ${groupBy}s, oldest first:`,
            ...points.slice(-6),
          ]
        : [`By ${groupBy}${timeSeries ? ", oldest first" : ""}:`, ...points];

    return {
      text: [
        `Period: last ${days} days (${day(from)} to ${day(to)}) vs the ${days} days before (${day(prevFrom)} to ${day(from)}).`,
        `Revenue ${usd(current.revenue)} vs ${usd(previous.revenue)} (${pct(change(current.revenue, previous.revenue))}); orders ${current.orders} vs ${previous.orders} (${pct(change(current.orders, previous.orders))}); average order ${usd(current.aov)} vs ${usd(previous.aov)} (${pct(change(current.aov, previous.aov))}); refunds ${usd(current.refunds)} vs ${usd(previous.refunds)} (${pct(change(current.refunds, previous.refunds))}).`,
        ...series,
        "Already shown to the user as stat tiles and a chart: summarize trends, don't list the numbers again.",
      ].join("\n"),
      ui: [
        ui.stats(
          [
            { label: "Revenue", value: current.revenue, format: "currency", delta: change(current.revenue, previous.revenue), deltaLabel: `vs prior ${days}d` },
            { label: "Orders", value: current.orders, format: "integer", delta: change(current.orders, previous.orders) },
            { label: "Avg. order value", value: current.aov, format: "currency", delta: change(current.aov, previous.aov) },
            { label: "Refunds", value: current.refunds, format: "currency", delta: change(current.refunds, previous.refunds), invertDelta: true },
          ],
          `Sales · last ${days} days`,
        ),
        ui.chart({
          title: `Revenue by ${groupBy}`,
          kind: timeSeries ? (groupBy === "day" ? "area" : "bar") : "bar",
          x: { key: "label", format: groupBy === "day" ? "date" : "text" },
          series: [{ key: "revenue", label: "Revenue", format: "currency" }],
          data: breakdown,
        }),
      ],
    };
  },
});

export const queryDatabase = defineTool({
  name: "query_database",
  label: "Run SQL query",
  readOnly: true,
  roles: ["admin", "analyst"],
  description: `Run one read-only SQLite SELECT against the store database for questions other tools can't answer. Results over 500 rows are cut off; aggregate in SQL. Schema:\n${SCHEMA_SUMMARY}`,
  parameters: Type.Object({
    sql: Type.String({ description: "A single SELECT (or WITH ... SELECT) statement" }),
    title: Type.Optional(Type.String({ description: "Short caption for the result table" })),
  }),
  execute: ({ sql, title }, ctx) => {
    const statement = sql.trim().replace(/;\s*$/, "");
    if (!/^(select|with)\b/i.test(statement)) return { text: "Only SELECT queries are allowed.", isError: true };
    if (statement.includes(";")) return { text: "Send one statement at a time.", isError: true };
    ctx.progress("Running query…");
    const started = performance.now();
    let rows: Row[];
    try {
      rows = getReadonlyDb().prepare(`SELECT * FROM (${statement}) LIMIT 501`).all() as Row[];
    } catch (error) {
      return { text: `SQL error: ${error instanceof Error ? error.message : error}`, isError: true };
    }
    const truncated = rows.length > 500;
    if (truncated) rows = rows.slice(0, 500);
    const ms = Math.round(performance.now() - started);
    const table = autoTable(rows, title ?? "Query result");
    if (table) table.caption = `${rows.length}${truncated ? "+" : ""} rows · ${ms} ms`;
    return {
      text: `${rows.length}${truncated ? "+ (truncated)" : ""} rows.${rows.length > 50 ? " First 50:" : ""}\n${JSON.stringify(rows.slice(0, 50))}`,
      data: rows,
      ui: table ?? ui.alert("info", "The query returned no rows."),
    };
  },
});
