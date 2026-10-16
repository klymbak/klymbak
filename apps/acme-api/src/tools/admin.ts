import { defineTool, StringEnum, Type, ui } from "@klymbak/server";
import { getDb, type Row } from "../db/database.ts";

export const createDiscountCode = defineTool({
  name: "create_discount_code",
  label: "Create discount code",
  roles: ["admin"],
  description: "Create a percentage discount code for marketing or goodwill. Codes are uppercase letters and digits.",
  parameters: Type.Object({
    percent: Type.Integer({ minimum: 5, maximum: 50 }),
    expiresInDays: Type.Integer({ minimum: 1, maximum: 365 }),
    usageLimit: Type.Integer({ minimum: 1, maximum: 100000 }),
    code: Type.Optional(Type.String({ description: "Leave empty to generate one" })),
  }),
  approval: ({ percent, usageLimit, code }) => ({
    title: `Create ${percent}% code${code ? ` ${code.toUpperCase()}` : ""} for up to ${usageLimit} uses`,
    risk: percent >= 30 || usageLimit > 1000 ? "high" : "medium",
  }),
  execute: ({ percent, expiresInDays, usageLimit, code }, ctx) => {
    const value = (code ?? `ACME${percent}${Math.random().toString(36).slice(2, 6)}`).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const db = getDb();
    if (db.prepare("SELECT 1 FROM discount_codes WHERE code = ?").get(value)) return { text: `Code ${value} already exists.`, isError: true };
    const expires = new Date(Date.now() + expiresInDays * 86_400_000).toISOString();
    db.prepare("INSERT INTO discount_codes (code, percent, usage_limit, times_used, expires_at, created_by, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)").run(
      value,
      percent,
      usageLimit,
      expires,
      ctx.user.name,
      new Date().toISOString(),
    );
    return {
      text: `Created code ${value}: ${percent}% off, ${usageLimit} uses, expires ${expires.slice(0, 10)}.`,
      ui: ui.keyValue(
        [
          { label: "Code", value, format: "code" },
          { label: "Discount", value: `${percent}%` },
          { label: "Uses", value: usageLimit, format: "integer" },
          { label: "Expires", value: expires, format: "date" },
        ],
        "Discount code created",
      ),
    };
  },
});

export const notifyTeam = defineTool({
  name: "notify_team",
  label: "Post to team channel",
  description: "Post a short message to an internal team chat channel (#ops, #support or #finance). Use for alerts and briefings.",
  parameters: Type.Object({
    channel: StringEnum(["#ops", "#support", "#finance"]),
    message: Type.String({ description: "Plain text or simple markdown, under 1000 characters" }),
  }),
  execute: ({ channel, message }, ctx) => {
    getDb()
      .prepare("INSERT INTO team_messages (channel, message, created_by, created_at) VALUES (?, ?, ?, ?)")
      .run(channel, message.slice(0, 1000), ctx.headless ? "Acme agent (scheduled)" : `Acme agent for ${ctx.user.name}`, new Date().toISOString());
    return { text: `Posted to ${channel}.`, ui: ui.markdown(`**Posted to ${channel}**\n\n${message}`) };
  },
});

export const getAuditLog = defineTool({
  name: "get_audit_log",
  label: "Audit log",
  readOnly: true,
  roles: ["admin"],
  description: "Recent changes made through the agent (refunds, stock changes, replies...) with who made them and when.",
  parameters: Type.Object({ limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })) }),
  execute: ({ limit = 30 }) => {
    const rows = getDb().prepare("SELECT at, actor, action, details, via FROM audit_log ORDER BY at DESC LIMIT ?").all(limit) as Row[];
    return {
      text: rows.map((r) => `${r.at} ${r.actor} ${r.action} ${r.details} (${r.via})`).join("\n") || "No entries.",
      ui: ui.table({
        title: "Audit log",
        columns: [
          { key: "at", label: "When", format: "datetime" },
          { key: "actor", label: "Who" },
          { key: "action", label: "Action", format: "code" },
          { key: "details", label: "Details" },
          { key: "via", label: "Via", format: "badge", tones: { chat: "info", schedule: "accent" } },
        ],
        rows,
      }),
    };
  },
});
