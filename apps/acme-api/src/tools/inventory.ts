import { defineTool, Type, ui } from "@klymbak/server";
import { getDb, transaction, type Row } from "../db/database.ts";
import { isoDaysAgo, like, usd } from "./util.ts";

export const listProducts = defineTool({
  name: "list_products",
  label: "Products & stock",
  readOnly: true,
  description:
    "List catalog products with price, stock, reorder level and units sold in the last 30 days. Filter by category, name, or only items at/below their reorder level.",
  parameters: Type.Object({
    query: Type.Optional(Type.String({ description: "Part of a product name or SKU" })),
    category: Type.Optional(Type.String({ description: "Tents, Sleeping, Backpacks, Jackets, Footwear, Climbing, Cooking, Accessories" })),
    lowStockOnly: Type.Optional(Type.Boolean()),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }),
  execute: ({ query, category, lowStockOnly, limit = 50 }) => {
    const rows = getDb()
      .prepare(
        `SELECT p.id, p.sku, p.name, p.category, p.price, p.stock, p.reorder_level, p.supplier,
                COALESCE((SELECT SUM(i.quantity) FROM order_items i JOIN orders o ON o.id = i.order_id
                          WHERE i.product_id = p.id AND o.created_at >= ?1 AND o.status != 'cancelled'), 0) AS sold_30d
         FROM products p
         WHERE p.active = 1
           AND (?2 IS NULL OR p.name LIKE ?2 OR p.sku LIKE ?2)
           AND (?3 IS NULL OR lower(p.category) = lower(?3))
           AND (?4 = 0 OR p.stock <= p.reorder_level)
         ORDER BY CASE WHEN p.stock <= p.reorder_level THEN 0 ELSE 1 END, p.stock * 1.0 / MAX(p.reorder_level, 1), p.name
         LIMIT ?5`,
      )
      .all(isoDaysAgo(30), like(query), category ?? null, lowStockOnly ? 1 : 0, limit) as Row[];

    const withState: Row[] = rows.map((r) => {
      const stock = Number(r.stock);
      const sold = Number(r.sold_30d);
      return {
        ...r,
        state: stock === 0 ? "out of stock" : stock <= Number(r.reorder_level) ? "low" : "ok",
        days_left: sold > 0 ? Math.round(stock / (sold / 30)) : null,
      };
    });

    return {
      text: withState.map((r) => `${r.sku} ${r.name} (${r.category}) ${usd(r.price)} · stock ${r.stock} / reorder at ${r.reorder_level} · sold ${r.sold_30d} in 30d · ${r.state}${r.days_left !== null ? ` · ~${r.days_left} days left` : ""} · supplier ${r.supplier}`).join("\n") || "No products match.",
      ui: ui.table({
        title: lowStockOnly ? "Products at or below reorder level" : "Products",
        rowKey: "sku",
        columns: [
          { key: "sku", label: "SKU", format: "code" },
          { key: "name", label: "Product" },
          { key: "category", label: "Category" },
          { key: "price", label: "Price", format: "currency", align: "right" },
          { key: "stock", label: "Stock", format: "integer", align: "right" },
          { key: "reorder_level", label: "Reorder at", format: "integer", align: "right" },
          { key: "sold_30d", label: "Sold 30d", format: "integer", align: "right" },
          { key: "days_left", label: "Days left", format: "integer", align: "right" },
          { key: "state", label: "State", format: "badge", tones: { ok: "success", low: "warning", "out of stock": "danger" } },
        ],
        rows: withState,
        rowActions: [{ label: "Restock", prompt: "Receive a restock for {sku} ({name})" }],
      }),
    };
  },
});

export const adjustInventory = defineTool({
  name: "adjust_inventory",
  label: "Adjust stock",
  roles: ["admin"],
  description: "Change a product's stock level: positive delta to receive a delivery, negative to write off damaged or lost units.",
  parameters: Type.Object({
    sku: Type.String(),
    delta: Type.Integer({ description: "Units to add (positive) or remove (negative)" }),
    reason: Type.String({ description: "e.g. 'Received PO-2350' or 'Water damage in warehouse'" }),
  }),
  approval: ({ sku, delta, reason }) => {
    const product = getDb().prepare("SELECT name, stock FROM products WHERE sku = ?").get(sku) as Row | undefined;
    return {
      title: `${delta > 0 ? "Receive" : "Write off"} ${Math.abs(delta)} × ${product?.name ?? sku}`,
      description: `Stock ${product?.stock ?? "?"} → ${product ? Number(product.stock) + delta : "?"}. Reason: ${reason}`,
      risk: delta < 0 ? "medium" : "low",
    };
  },
  execute: ({ sku, delta, reason }, ctx) => {
    const product = getDb().prepare("SELECT id, name, stock FROM products WHERE sku = ?").get(sku) as Row | undefined;
    if (!product) return { text: `No product with SKU ${sku}.`, isError: true };
    const next = Number(product.stock) + delta;
    if (next < 0) return { text: `Can't remove ${-delta} units: only ${product.stock} in stock.`, isError: true };
    transaction((db) => {
      db.prepare("UPDATE products SET stock = ? WHERE id = ?").run(next, product.id);
      db.prepare("INSERT INTO inventory_movements (product_id, delta, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(product.id, delta, reason, ctx.user.name, new Date().toISOString());
    });
    return `${product.name} (${sku}) stock changed from ${product.stock} to ${next}. Reason: ${reason}.`;
  },
});
