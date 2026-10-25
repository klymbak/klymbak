import { mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { seed } from "./seed.ts";

/** The database, conversations and knowledge caches. ACME_DATA_DIR moves them, e.g. for a second copy of the demo. */
export const DATA_DIR = process.env.ACME_DATA_DIR ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
export const DB_PATH = join(DATA_DIR, "acme.db");

export const SCHEMA = `
CREATE TABLE customers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  country TEXT NOT NULL,
  city TEXT NOT NULL,
  segment TEXT NOT NULL,            -- new | regular | vip | wholesale
  marketing_opt_in INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  price REAL NOT NULL,
  cost REAL NOT NULL,
  stock INTEGER NOT NULL,
  reorder_level INTEGER NOT NULL,
  supplier TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,           -- shown to staff as #1042
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  status TEXT NOT NULL,             -- pending | paid | shipped | delivered | cancelled | refunded
  channel TEXT NOT NULL,            -- web | mobile | marketplace
  subtotal REAL NOT NULL,
  shipping REAL NOT NULL,
  discount REAL NOT NULL,
  total REAL NOT NULL,
  discount_code TEXT,
  shipping_country TEXT NOT NULL,
  carrier TEXT,
  tracking_number TEXT,
  created_at TEXT NOT NULL,
  shipped_at TEXT,
  delivered_at TEXT
);
CREATE TABLE order_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL
);
CREATE TABLE refunds (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE tickets (
  id INTEGER PRIMARY KEY,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  order_id INTEGER REFERENCES orders(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,             -- open | pending | closed
  priority TEXT NOT NULL,           -- low | normal | high | urgent
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE ticket_replies (
  id INTEGER PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id),
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE discount_codes (
  code TEXT PRIMARY KEY,
  percent INTEGER NOT NULL,
  usage_limit INTEGER NOT NULL,
  times_used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE inventory_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE team_messages (
  id INTEGER PRIMARY KEY,
  channel TEXT NOT NULL,
  message TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT NOT NULL,
  via TEXT NOT NULL                 -- chat | schedule
);
CREATE INDEX orders_customer ON orders(customer_id);
CREATE INDEX orders_created ON orders(created_at);
CREATE INDEX items_order ON order_items(order_id);
CREATE INDEX tickets_customer ON tickets(customer_id);
`;

/** Human-readable schema for the SQL tool's description. */
export const SCHEMA_SUMMARY = `customers(id, name, email, phone, country, city, segment[new|regular|vip|wholesale], marketing_opt_in, created_at)
products(id, sku, name, category, price, cost, stock, reorder_level, supplier, active)
orders(id, customer_id, status[pending|paid|shipped|delivered|cancelled|refunded], channel[web|mobile|marketplace], subtotal, shipping, discount, total, discount_code, shipping_country, carrier, tracking_number, created_at, shipped_at, delivered_at)
order_items(id, order_id, product_id, quantity, unit_price)
refunds(id, order_id, amount, reason, created_by, created_at)
tickets(id, customer_id, order_id, subject, body, status[open|pending|closed], priority[low|normal|high|urgent], created_at, updated_at)
discount_codes(code, percent, usage_limit, times_used, expires_at, created_by, created_at)
inventory_movements(id, product_id, delta, reason, created_by, created_at)
Dates are ISO-8601 UTC strings like 2026-10-15T14:03:00.000Z. Filter with created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days') and group with date(created_at). Money is USD. Revenue usually excludes cancelled orders.`;

let db: DatabaseSync | undefined;
let readonlyDb: DatabaseSync | undefined;

/** Opens the demo database, creating and seeding it on first use. */
export function getDb(): DatabaseSync {
  if (db) return db;
  mkdirSync(DATA_DIR, { recursive: true });
  const fresh = !existsSync(DB_PATH);
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  if (fresh) {
    db.exec(SCHEMA);
    seed(db);
  }
  return db;
}

/** A second, read-only connection for model-written SQL. SQLite enforces it. */
export function getReadonlyDb(): DatabaseSync {
  getDb();
  readonlyDb ??= new DatabaseSync(DB_PATH, { readOnly: true });
  return readonlyDb;
}

export function resetDb() {
  readonlyDb?.close();
  db?.close();
  readonlyDb = undefined;
  db = undefined;
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_PATH + suffix, { force: true });
  return getDb();
}

export function transaction<T>(work: (db: DatabaseSync) => T): T {
  const conn = getDb();
  conn.exec("BEGIN");
  try {
    const result = work(conn);
    conn.exec("COMMIT");
    return result;
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
}

export function audit(actor: string, action: string, details: string, via: "chat" | "schedule") {
  getDb()
    .prepare("INSERT INTO audit_log (at, actor, action, details, via) VALUES (?, ?, ?, ?, ?)")
    .run(new Date().toISOString(), actor, action, details, via);
}

/** A database row. Values come straight from SQLite, so they are untyped at this boundary. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
