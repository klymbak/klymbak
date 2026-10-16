import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { agent } from "./agent.ts";
import { getDb, resetDb, type Row } from "./db/database.ts";
import { DEMO_USERS, demoAuth } from "./users.ts";

const app = new Hono();

// The agent API: sessions, runs (SSE), approvals, schedules, MCP, notifications.
app.route("/api/agent", agent.app);

// Demo-only endpoints.
app.get("/api/demo/users", (c) => c.json(Object.entries(DEMO_USERS).map(([key, user]) => ({ key, ...user }))));
app.get("/api/demo/team-messages", (c) =>
  c.json(getDb().prepare("SELECT channel, message, created_by, created_at FROM team_messages ORDER BY created_at DESC LIMIT 20").all() as Row[]),
);
app.post("/api/demo/reset", (c) => {
  if (!demoAuth(c.req.raw).roles.includes("admin")) return c.json({ error: "Only admins can reset the demo." }, 403);
  resetDb();
  return c.json({ ok: true });
});

// In production the console is served from here, so the demo deploys as one service.
const consoleDist = fileURLToPath(new URL("../../acme-console/dist", import.meta.url));
if (existsSync(consoleDist)) {
  const root = relative(process.cwd(), consoleDist) || ".";
  const index = readFileSync(`${consoleDist}/index.html`, "utf8");
  app.use("/*", serveStatic({ root }));
  app.get("*", (c) => (c.req.path.startsWith("/api/") ? c.notFound() : c.html(index)));
}

getDb();
const port = Number(process.env.PORT ?? 8787);
await agent.start();
serve({ fetch: app.fetch, port }, () => {
  console.log(`Acme back office API on http://localhost:${port}/api/agent`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await agent.stop();
    process.exit(0);
  });
}
