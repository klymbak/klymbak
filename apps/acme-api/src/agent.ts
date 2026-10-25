import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentServer,
  fileStorage,
  lmStudio,
  ollama,
  type ScheduleDefinition,
  type SubagentDefinition,
} from "@klymbak/server";
import { DATA_DIR, DB_PATH } from "./db/database.ts";
import { hooks } from "./hooks.ts";
import { tools } from "./tools/index.ts";
import { demoAuth } from "./users.ts";

const env = process.env;
const list = (value: string | undefined) => value?.split(",").map((s) => s.trim()).filter(Boolean);

const SYSTEM_PROMPT = `You are the back-office agent for Acme Outfitters, an online outdoor-gear store (tents, sleeping gear, packs, apparel, footwear, climbing and cooking gear). Staff use you instead of the old admin panel: they look up customers and orders, handle refunds and returns, manage stock, ask reporting questions and set up recurring reports. You are talking to Acme staff, never to customers; customers only see what you send through tools such as reply_to_ticket.

Facts:
- Currency is USD. Order numbers look like #1042; pass just the number to tools.
- Channels: web, mobile app, marketplace. Ships to US, CA, UK, DE, FR, NL, SE, AU.
- Parcels go out with UPS, FedEx, DHL and USPS; the carrier_* tools talk to the ParcelPoint carrier platform.
- Refund rules are enforced automatically when you call refund_order (small refunds go straight through, larger ones ask for approval, some roles have limits). Just call the tool when a refund is warranted.

When a customer has a problem, check the order, the shipment and the ticket before proposing a fix, then offer concrete options (refund, replacement, return label, discount code).`;

const subagents: SubagentDefinition[] = [
  {
    name: "analyst",
    description: "Data analyst for sales trends, cohorts, product performance and ad-hoc questions that need SQL. Read-only.",
    systemPrompt:
      "You are Acme Outfitters' data analyst. Answer with numbers from sales_report or query_database. State the period and definitions you used (revenue excludes cancelled orders). Prefer one aggregated query over many small ones. End with two or three short insights.",
    tools: ["sales_report", "query_database", "list_orders", "list_products", "search_customers"],
    maxTurns: 10,
  },
  {
    name: "support",
    description: "Customer-support specialist: investigates a customer's orders, shipments and tickets and drafts the reply.",
    systemPrompt:
      "You are an Acme Outfitters customer-support specialist. Investigate the customer, their order, the shipment and the ticket before acting. Propose the smallest fix that makes the customer whole, and draft replies in a warm, concise tone signed 'The Acme support team'.",
    tools: ["search_customers", "get_customer", "list_orders", "get_order", "list_tickets", "get_ticket", "reply_to_ticket", "refund_order", "carrier_track_shipment", "carrier_create_return_label"],
    maxTurns: 12,
  },
  {
    name: "inventory",
    description: "Inventory planner: stock risks, reorder quantities and shipping costs.",
    systemPrompt:
      "You are Acme Outfitters' inventory planner. Use stock levels and the last 30 days of sales to flag risks and suggest reorder quantities that cover 45 days of sales plus the reorder level. Mention the supplier for each item.",
    tools: ["list_products", "adjust_inventory", "sales_report", "carrier_get_shipping_quote", "notify_team"],
    maxTurns: 10,
  },
];

const schedules: ScheduleDefinition[] = [
  {
    id: "morning-briefing",
    name: "Morning ops briefing",
    cron: "0 8 * * 1-5",
    prompt:
      "Prepare the morning ops briefing: yesterday's revenue and order count compared with the same weekday last week, orders still waiting to ship, open urgent or high-priority tickets, and products at or below their reorder level. Post a five-line summary to #ops with notify_team, then reply with the full briefing.",
    audience: ["admin"],
  },
  {
    id: "low-stock-watch",
    name: "Low-stock watch",
    cron: "0 */4 * * *",
    agent: "inventory",
    enabled: false,
    prompt:
      "Check products at or below their reorder level. If any are out of stock, post them to #ops with notify_team. Report suggested reorder quantities with suppliers.",
    audience: ["admin"],
  },
  {
    id: "ticket-replies",
    name: "Draft replies to open tickets",
    cron: "0 * * * *",
    enabled: false,
    prompt:
      "Answer up to three open support tickets, most urgent first. For each, read it with get_ticket, check the related order, then reply to the customer with reply_to_ticket. Replies wait for the support team's approval, so write each one ready to send.",
    audience: ["admin", "support"],
  },
];

const local = env.LOCAL_MODELS !== "0";
const carrierServer = fileURLToPath(new URL("../../carrier-mcp/src/server.ts", import.meta.url));

export const agent = createAgentServer({
  app: {
    name: "Acme Back Office",
    description: "Customers, orders, refunds, stock and reports, through one conversation.",
    suggestions: [
      "How did sales do this week compared with last week?",
      "Which products are about to run out?",
      "jane.cooper@example.com says her tent arrived torn. Sort it out.",
      "Where is Liam Novak's order? He says it's stuck.",
      "Show urgent support tickets",
      "Every Monday at 9:00, send me a summary of last week's refunds",
    ],
  },
  systemPrompt: SYSTEM_PROMPT,
  models: {
    providers: ["anthropic", "openai", "google", "openrouter", "groq", "xai", "mistral", "azure", "amazon-bedrock"],
    custom: local
      ? [
          lmStudio({ baseUrl: env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1" }),
          ollama({ baseUrl: env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1" }),
        ]
      : [],
    allow: list(env.AGENT_MODEL_ALLOW) ?? [
      "anthropic/claude-*-5*",
      "openai/gpt-6*",
      "openai/gpt-5.5",
      "openai/gpt-5.4-mini",
      "google/gemini-3.8-flash",
      "google/gemini-3.1-pro-preview",
      "google/gemini-4*",
      "openrouter/anthropic/claude-sonnet-5*",
      "openrouter/qwen/qwen3.8*",
      "groq/*",
      "xai/grok-4.7",
      "mistral/mistral-large-latest",
      "mistral/mistral-medium-latest",
      "azure/*",
      "amazon-bedrock/*claude*",
      "lmstudio/*",
      "ollama/*",
    ],
    default: list(env.AGENT_DEFAULT_MODEL) ?? [
      "anthropic/claude-sonnet-5-5",
      "openai/gpt-6.1-sol",
      "google/gemini-3.8-flash",
      "lmstudio/qwen/qwen3.6-35b-a3b",
    ],
  },
  tools,
  mcpServers: {
    carrier: {
      // Node runs the TypeScript server directly (type stripping, Node 22.18+).
      command: process.execPath,
      // Node's SQLite still warns that it's experimental, on stderr where it would land in the log.
      args: ["--disable-warning=ExperimentalWarning", carrierServer],
      // The carrier suggests the store's tracking numbers as people type, standing in for its account API.
      env: { CARRIER_SHIPMENTS_DB: DB_PATH },
      approval: ["create_return_label"],
    },
  },
  hooks,
  subagents,
  schedules,
  storage: fileStorage(join(DATA_DIR, "agent")),
  runtimeMcp: true,
  auth: demoAuth,
});
