import { DB_PATH, resetDb } from "./database.ts";

const db = resetDb();
const counts = ["customers", "products", "orders", "tickets"].map(
  (table) => `${(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n} ${table}`,
);
console.log(`Seeded ${DB_PATH}: ${counts.join(", ")}`);
