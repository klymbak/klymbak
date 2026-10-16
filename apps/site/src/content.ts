/** Edit these to point at your own profile, repo and hosted demo. */
export const links = {
  demo: import.meta.env.VITE_DEMO_URL ?? "http://localhost:5173",
  hire: import.meta.env.VITE_HIRE_URL ?? "https://www.upwork.com/freelancers/",
  repo: import.meta.env.VITE_REPO_URL ?? "https://github.com/",
  email: import.meta.env.VITE_CONTACT_EMAIL ?? "hello@example.com",
};

export interface Step {
  id: string;
  title: string;
  body: string;
  points: string[];
  deliverable: string;
  time: string;
  code?: { file: string; source: string };
}

export const steps: Step[] = [
  {
    id: "map",
    title: "Map the work people actually do",
    body: "We sit with the people who live in your admin panel (ops, support, finance) and list the twenty tasks they repeat most, where each one touches data, and what could go wrong.",
    points: ["Screens and exports used each week", "Which tasks only read data and which change it", "Who may do what, and the limits that apply"],
    deliverable: "A capability map: task → system → risk → owner",
    time: "2–3 days",
  },
  {
    id: "wrap",
    title: "Wrap what you already have as tools",
    body: "Each task becomes a typed tool over your existing API or database. Nothing gets rewritten, and third-party systems plug in through MCP. Results come back as tables, charts and cards, while the model only reads a compact summary.",
    points: ["Typed parameters the model can't get wrong silently", "Tables and charts for people, short text for the model", "MCP servers for Stripe, Zendesk, carriers or your own services"],
    deliverable: "A tool catalogue running against staging",
    time: "Week 1",
    code: {
      file: "tools/orders.ts",
      source: `export const refundOrder = defineTool({
  name: "refund_order",
  description: "Refund all or part of an order.",
  parameters: Type.Object({
    orderId: Type.Integer(),
    amount: Type.Optional(Type.Number()),
    reason: Type.String(),
  }),
  // A person signs off before any money moves.
  approval: ({ amount }) => ({ title: \`Refund $\${amount}\`, risk: "high" }),
  execute: async ({ orderId, amount, reason }, ctx) => {
    await payments.refund(orderId, amount, { by: ctx.user.id, reason });
    return { text: "Refunded.", ui: ui.alert("success", "Refund issued") };
  },
});`,
    },
  },
  {
    id: "guard",
    title: "Put the guardrails in code, not in the prompt",
    body: "The agent acts as the signed-in person, with their roles. Anything that changes data stops for approval. Policy hooks enforce limits the model can't talk its way around, and every action lands in your audit log.",
    points: ["Approvals show the exact amount, recipient and draft", "Role limits, PII masking and blocked actions as hooks", "Audit trail with who asked, what ran and who approved"],
    deliverable: "Security review notes and a written policy file",
    time: "Week 1–2",
    code: {
      file: "hooks.ts",
      source: `export const refundPolicy: Hook = {
  name: "refund-policy",
  tools: ["refund_order"],
  preToolUse: ({ args, ctx }) => {
    if (args.amount > 1000)
      return { decision: "deny", reason: "Over $1,000 goes to finance." };
    if (!ctx.user.roles.includes("admin") && args.amount > 150)
      return { decision: "deny", reason: "Support can refund up to $150." };
    if (args.amount <= 25) return { decision: "allow" }; // goodwill
  },
};`,
    },
  },
  {
    id: "models",
    title: "Choose the model, or let people choose",
    body: "Claude, GPT, Gemini, or private models on your own hardware through Ollama, LM Studio, vLLM, Azure or Bedrock. People can switch models per conversation, and every run reports its tokens and cost.",
    points: ["Cloud, private cloud or fully on-premises", "An allow-list of approved models", "Per-run token and cost reporting"],
    deliverable: "Model shortlist with cost per typical task",
    time: "Week 2",
  },
  {
    id: "embed",
    title: "Drop the chat into your product",
    body: "A Vue 3 component library: a full workspace, a single chat, or a floating widget that sits next to your current panel, so you don't have to switch everything over on day one. Theme it with a few CSS variables.",
    points: ["Streaming answers, tool cards and approvals", "Your own Vue components for any tool's results", "Works behind your existing login"],
    deliverable: "The agent inside your app, behind your auth",
    time: "Week 2",
    code: {
      file: "AdminPage.vue",
      source: `<script setup lang="ts">
import { AgentWorkspace } from "@klymbak/vue";
import "@klymbak/vue/style.css";
</script>

<template>
  <AgentWorkspace base-url="/api/agent" />
</template>`,
    },
  },
  {
    id: "automate",
    title: "Automate the routine, then measure",
    body: "Scheduled tasks send the morning briefing and watch stock or SLAs on their own. Specialist subagents take focused work. Transcripts show what people asked and where the agent struggled, so each week's improvements come from real use.",
    points: ["Briefings and watchdogs on a schedule", "Specialists for analysis, support and inventory", "Weekly review of transcripts, costs and failures"],
    deliverable: "Pilot report and a rollout plan",
    time: "Week 3",
  },
];

export const capabilities: { name: string; what: string; code: string }[] = [
  { name: "Human approval", what: "Anything that changes data waits for a person, who sees the exact amount, recipient or draft.", code: "approval: (args) => …" },
  { name: "Policy hooks", what: "Role limits, blocked actions and PII masking are enforced in code before and after every tool call.", code: "preToolUse · postToolUse" },
  { name: "Your systems as tools", what: "Existing APIs and SQL become typed actions. People see tables and charts; the model reads a summary.", code: "defineTool()" },
  { name: "MCP integrations", what: "Connect third-party or in-house MCP servers and their tools appear in the agent, with approvals respected.", code: "mcpServers: { … }" },
  { name: "Specialist subagents", what: "An analyst, a support specialist or an inventory planner with narrower tools, working in parallel.", code: "subagents: [ … ]" },
  { name: "Scheduled tasks", what: "Morning briefings and watchdogs run on cron, post to your team chat and notify the people who need it.", code: "schedules: [ … ]" },
  { name: "Any model", what: "Claude, GPT, Gemini, or private models via Ollama, LM Studio, vLLM, Azure or Bedrock.", code: "models: { … }" },
  { name: "Steering", what: "Add an instruction while the agent works. It reads it after the current step and changes course.", code: "POST /sessions/:id/steer" },
  { name: "Audit trail", what: "Who asked, what ran, what changed and who approved it, written to your own store.", code: "auditTrail(sink)" },
];

export const pilot: { week: string; title: string; text: string }[] = [
  { week: "Week 1", title: "Map and wrap", text: "Capability map, first ten tools against staging, guardrail design." },
  { week: "Week 2", title: "Guard and embed", text: "Policy hooks, approvals, audit log; the chat inside your app behind your login." },
  { week: "Week 3", title: "Pilot", text: "Three to five people use it for real work. We review transcripts and costs, then fix what they hit." },
];

export const faq: { q: string; a: string }[] = [
  {
    q: "Will it make things up?",
    a: "It looks things up through your tools instead of answering from memory, and it's told to say when a tool finds nothing. Numbers come from your systems and are shown to people as the tool returned them, in tables and charts the model doesn't retype.",
  },
  {
    q: "What if it does something wrong?",
    a: "Read-only tools run freely. Anything that changes data stops for a person's approval, with the exact details shown. Hooks block what policy forbids, whatever the model asks for, and the audit log records every action with the approver.",
  },
  {
    q: "Do we have to throw away our admin panel?",
    a: "No. Most teams start with the floating widget next to the existing panel, then move workflows across as people stop opening the old screens.",
  },
  {
    q: "Can our data stay on our own servers?",
    a: "Yes. The agent server runs in your infrastructure, and it can use local models (Ollama, LM Studio, vLLM) or your cloud account's Azure OpenAI or Bedrock, so prompts and data never reach a third party you haven't chosen.",
  },
  {
    q: "What does it cost to run?",
    a: "A typical admin task costs a fraction of a cent to a few cents in model tokens, and every run reports its own usage. Local models cost only the hardware.",
  },
  {
    q: "Which stacks do you support?",
    a: "The reference build is Vue 3 and Node (TypeScript) on the MIT-licensed pi agent harness. The protocol is plain HTTP and server-sent events, so React, Angular or a .NET back end are straightforward additions.",
  },
];
