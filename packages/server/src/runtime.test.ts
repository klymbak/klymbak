import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type FauxProviderHandle,
  type Message,
} from "@earendil-works/pi-ai";
import {
  readSseStream,
  type AgentEvent,
  type ChatMessage,
  type ToolPart,
} from "@klymbak/protocol";
import { createAgentRoutes } from "./http.ts";
import { redactPii } from "./hooks.ts";
import { AgentRuntime } from "./runtime.ts";
import { memoryStorage } from "./storage.ts";
import { defineTool } from "./tool.ts";
import { Type } from "@earendil-works/pi-ai";
import type { AgentRuntimeConfig, AgentUser, Hook } from "./types.ts";

const admin: AgentUser = { id: "u1", name: "Ada Admin", roles: ["admin"] };
const support: AgentUser = { id: "u2", name: "Sam Support", roles: ["support"] };
const quiet = { info() {}, warn() {}, error() {} };

let faux: FauxProviderHandle;
let runtime: AgentRuntime;
let executed: string[];

const lookupOrder = defineTool({
  name: "lookup_order",
  description: "Look up an order",
  readOnly: true,
  parameters: Type.Object({ id: Type.String() }),
  execute: ({ id }) => {
    executed.push(`lookup:${id}`);
    return {
      text: `Order ${id}: shipped, total $120, customer jane@example.com`,
      ui: { type: "table", columns: [{ key: "email", label: "Email" }], rows: [{ email: "jane@example.com" }] },
    };
  },
});

const refundOrder = defineTool({
  name: "refund_order",
  description: "Refund an order",
  parameters: Type.Object({ id: Type.String(), amount: Type.Number() }),
  approval: (args) => (args.amount > 50 ? { title: `Refund $${args.amount}`, risk: "high" } : false),
  execute: ({ id, amount }) => {
    executed.push(`refund:${id}:${amount}`);
    return `Refunded $${amount} on ${id}`;
  },
});

function setup(overrides: Partial<AgentRuntimeConfig> = {}) {
  faux = fauxProvider({ tokensPerSecond: 0 });
  executed = [];
  runtime = new AgentRuntime({
    systemPrompt: "You are a test agent.",
    models: { providers: [faux.provider] },
    tools: [lookupOrder, refundOrder],
    schedules: false,
    logger: quiet,
    ...overrides,
  });
}

/** Starts a run and collects its events; `onEvent` can react (e.g. approve). */
async function run(user: AgentUser, prompt: string, onEvent?: (event: AgentEvent, sessionId: string) => void) {
  const session = await runtime.createSession(user);
  const events: AgentEvent[] = [];
  const active = await runtime.startRun(user, session.id, { prompt }, (event) => {
    events.push(event);
    onEvent?.(event, session.id);
  });
  const outcome = await active.done;
  const detail = await runtime.getSession(user, session.id);
  return { events, outcome, detail, sessionId: session.id };
}

function tools(messages: ChatMessage[]): ToolPart[] {
  return messages.flatMap((m) => m.parts.filter((p): p is ToolPart => p.type === "tool"));
}

/** The text of the last tool result the model was sent. */
function lastToolResult(messages: Message[]): string {
  const result = [...messages].reverse().find((m) => m.role === "toolResult");
  return result && result.role === "toolResult" ? result.content.map((c) => (c.type === "text" ? c.text : "")).join("") : "";
}

afterEach(async () => {
  await runtime?.stop();
});

describe("AgentRuntime", () => {
  beforeEach(() => setup());

  it("streams a plain answer and titles the session from the prompt", async () => {
    faux.setResponses([fauxAssistantMessage("Hello there.")]);
    const { events, outcome, detail } = await run(admin, "Say hello to the team");

    expect(outcome.status).toBe("completed");
    expect(outcome.text).toBe("Hello there.");
    expect(events[0]!.type).toBe("run_start");
    expect(events.at(-1)!.type).toBe("run_end");
    expect(detail.title).toBe("Say hello to the team");
    expect(detail.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(detail.messages[1]!.parts).toEqual([{ type: "text", text: "Hello there." }]);
  });

  it("sends UI blocks to the user but only text to the model", async () => {
    let seenByModel = "";
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("lookup_order", { id: "A1" }), { stopReason: "toolUse" }),
      (context) => {
        seenByModel = lastToolResult(context.messages);
        return fauxAssistantMessage("It shipped.");
      },
    ]);
    const { detail } = await run(admin, "Where is order A1?");
    const [tool] = tools(detail.messages);

    expect(tool!.status).toBe("done");
    expect(tool!.label).toBe("Lookup order");
    expect(tool!.result?.ui?.[0]?.type).toBe("table");
    expect(seenByModel).toContain("Order A1: shipped");
    expect(seenByModel).not.toContain('"rows"');
  });

  it("pauses for approval and runs the tool once approved", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("refund_order", { id: "A1", amount: 80 }), { stopReason: "toolUse" }),
      fauxAssistantMessage("Refund issued."),
    ]);
    const { detail } = await run(admin, "Refund A1", (event, sessionId) => {
      if (event.type === "tool_update" && event.patch.approval?.status === "pending") {
        expect(event.patch.approval.title).toBe("Refund $80");
        void runtime.decide(admin, sessionId, event.patch.approval.id, { approved: true });
      }
    });
    const [tool] = tools(detail.messages);
    expect(executed).toEqual(["refund:A1:80"]);
    expect(tool!.status).toBe("done");
    expect(tool!.approval).toMatchObject({ status: "approved", decidedBy: "Ada Admin", risk: "high" });
  });

  it("skips approval when the policy says it is not needed", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("refund_order", { id: "A1", amount: 20 }), { stopReason: "toolUse" }),
      fauxAssistantMessage("Done."),
    ]);
    const { detail } = await run(admin, "Refund $20 on A1");
    expect(executed).toEqual(["refund:A1:20"]);
    expect(tools(detail.messages)[0]!.approval).toBeUndefined();
  });

  it("tells the model when a person denies the action", async () => {
    let seenByModel = "";
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("refund_order", { id: "A1", amount: 500 }), { stopReason: "toolUse" }),
      (context) => {
        seenByModel = lastToolResult(context.messages);
        return fauxAssistantMessage("Understood, no refund.");
      },
    ]);
    const { detail } = await run(admin, "Refund A1 fully", (event, sessionId) => {
      if (event.type === "tool_update" && event.patch.approval?.status === "pending") {
        void runtime.decide(admin, sessionId, event.patch.approval.id, { approved: false, reason: "Too large" });
      }
    });
    const [tool] = tools(detail.messages);
    expect(executed).toEqual([]);
    expect(tool!.status).toBe("denied");
    expect(tool!.approval?.status).toBe("denied");
    expect(seenByModel).toContain("Too large");
  });

  it("remembers 'always allow' for the rest of the session", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("refund_order", { id: "A1", amount: 60 }), { stopReason: "toolUse" }),
      fauxAssistantMessage("First done."),
      fauxAssistantMessage(fauxToolCall("refund_order", { id: "A2", amount: 70 }), { stopReason: "toolUse" }),
      fauxAssistantMessage("Second done."),
    ]);
    const session = await runtime.createSession(admin);
    let approvals = 0;
    const listener = (event: AgentEvent) => {
      if (event.type === "tool_update" && event.patch.approval?.status === "pending") {
        approvals++;
        void runtime.decide(admin, session.id, event.patch.approval.id, { approved: true, remember: true });
      }
    };
    await (await runtime.startRun(admin, session.id, { prompt: "Refund A1" }, listener)).done;
    await (await runtime.startRun(admin, session.id, { prompt: "Refund A2" }, listener)).done;
    expect(approvals).toBe(1);
    expect(executed).toEqual(["refund:A1:60", "refund:A2:70"]);
    expect((await runtime.getSession(admin, session.id)).allowedTools).toEqual(["refund_order"]);
  });

  it("refuses approval-gated actions in unattended runs", async () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("refund_order", { id: "A1", amount: 99 }), { stopReason: "toolUse" }),
      fauxAssistantMessage("Recommend refunding A1."),
    ]);
    const outcome = await runtime.runHeadless({ user: admin, prompt: "Nightly check", title: "Nightly" });
    const detail = await runtime.getSession(admin, outcome.sessionId);
    expect(executed).toEqual([]);
    expect(tools(detail.messages)[0]!.status).toBe("denied");
    expect(detail.source).toBe("api");
    expect(detail.unread).toBe(true);
  });

  it("stops runaway loops at maxTurns", async () => {
    setup({ maxTurns: 2 });
    faux.setResponses(
      Array.from({ length: 5 }, (_, i) =>
        fauxAssistantMessage(fauxToolCall("lookup_order", { id: `L${i}` }), { stopReason: "toolUse" }),
      ),
    );
    const { detail } = await run(admin, "Loop forever");
    expect(executed).toEqual(["lookup:L0", "lookup:L1"]);
    expect(detail.messages.at(-1)).toMatchObject({ role: "notice", level: "warning" });
  });
});

describe("hooks", () => {
  it("lets a preToolUse policy block a call", async () => {
    const policy: Hook = {
      name: "refund-limit",
      tools: ["refund_order"],
      preToolUse: ({ args, ctx }) =>
        !ctx.user.roles.includes("admin") && args.amount > 30 ? { decision: "deny", reason: "Support can refund up to $30." } : undefined,
    };
    setup({ hooks: [policy] });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("refund_order", { id: "A1", amount: 45 }), { stopReason: "toolUse" }),
      fauxAssistantMessage("I can't do that."),
    ]);
    const { detail } = await run(support, "Refund A1");
    const [tool] = tools(detail.messages);
    expect(tool!.status).toBe("blocked");
    expect(tool!.result?.text).toContain("Support can refund up to $30.");
    expect(executed).toEqual([]);
  });

  it("lets an allow decision skip the tool's own approval", async () => {
    setup({
      hooks: [{ name: "trusted", tools: ["refund_order"], preToolUse: () => ({ decision: "allow" }) }],
    });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("refund_order", { id: "A1", amount: 400 }), { stopReason: "toolUse" }),
      fauxAssistantMessage("Done."),
    ]);
    await run(admin, "Refund A1");
    expect(executed).toEqual(["refund:A1:400"]);
  });

  it("redacts PII in what both the model and the user see", async () => {
    setup({ hooks: [redactPii({ roles: ["support"] })] });
    let seenByModel = "";
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("lookup_order", { id: "A1" }), { stopReason: "toolUse" }),
      (context) => {
        seenByModel = lastToolResult(context.messages);
        return fauxAssistantMessage("Done.");
      },
    ]);
    const { detail } = await run(support, "Who ordered A1?");
    const [tool] = tools(detail.messages);
    expect(seenByModel).toContain("j•••@example.com");
    expect(seenByModel).not.toContain("jane@");
    expect(JSON.stringify(tool!.result?.ui)).not.toContain("jane@");
  });

  it("can refuse a prompt and add hidden context to others", async () => {
    let modelSaw = "";
    setup({
      hooks: [
        {
          name: "guard",
          userPromptSubmit: ({ prompt }) =>
            prompt.includes("drop table") ? { block: "That request isn't allowed." } : { context: "Store: EU-West" },
        },
      ],
    });
    faux.setResponses([
      (context) => {
        const user = context.messages.find((m) => m.role === "user");
        modelSaw = JSON.stringify(user);
        return fauxAssistantMessage("ok");
      },
    ]);
    const blocked = await run(admin, "please drop table orders");
    expect(blocked.detail.messages.map((m) => m.role)).toEqual(["user", "notice"]);

    const allowed = await run(admin, "hi");
    expect(modelSaw).toContain("Store: EU-West");
    expect(allowed.detail.messages[0]!.parts).toEqual([{ type: "text", text: "hi" }]);
  });

  it("keeps a conversation's system prompt, stored in its transcript, when it is resumed after a restart", async () => {
    const storage = memoryStorage();
    let starts = 0;
    const systemMessages: string[] = [];
    const config = (): Partial<AgentRuntimeConfig> => ({
      storage,
      hooks: [{ name: "facts", sessionStart: () => (starts++, { context: "Locales: en, fr" }) }],
    });
    const capture = (context: { messages: Message[] }) => systemMessages.push(JSON.stringify(context.messages.filter((m) => m.role === "system")));
    setup(config());
    faux.setResponses([(context) => (capture(context), fauxAssistantMessage("first")), (context) => (capture(context), fauxAssistantMessage("second"))]);
    const { sessionId } = await run(admin, "hi");
    // A new runtime over the same storage, as after a server restart.
    await runtime.stop();
    runtime = new AgentRuntime({
      systemPrompt: "You are a test agent.",
      models: { providers: [faux.provider] },
      tools: [lookupOrder, refundOrder],
      schedules: false,
      logger: quiet,
      ...config(),
    });
    await (await runtime.startRun(admin, sessionId, { prompt: "and now?" })).done;

    expect(starts).toBe(1);
    expect(systemMessages).toHaveLength(2);
    expect(systemMessages[0]).toMatch(/You are a test agent\..*Locales: en, fr/);
    expect(systemMessages[1]).toBe(systemMessages[0]);
  });

  it("gives the model what the person has open, without showing it in the transcript", async () => {
    const seen: string[] = [];
    faux.setResponses([
      (context) => {
        seen.push(JSON.stringify(context.messages.at(-1)));
        return fauxAssistantMessage("ok");
      },
    ]);
    const session = await runtime.createSession(admin);
    const active = await runtime.startRun(admin, session.id, { prompt: "Summarize this", context: `Order #1042 ${"x".repeat(5_000)}` });
    await active.done;
    const detail = await runtime.getSession(admin, session.id);

    expect(seen[0]).toContain("Open in the app right now: Order #1042");
    expect(seen[0]!.length).toBeLessThan(5_000);
    expect(detail.messages[0]!.parts).toEqual([{ type: "text", text: "Summarize this" }]);
  });
});

describe("subagents", () => {
  it("runs a delegated task and nests its transcript under the tool call", async () => {
    setup({
      subagents: [
        { name: "analyst", description: "Answers data questions", systemPrompt: "You analyse data.", tools: ["lookup_order"] },
      ],
    });
    let childSawRefundTool = true;
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("delegate_task", { agent: "analyst", task: "Check order A7" }), { stopReason: "toolUse" }),
      (context) => {
        // Child agent: its tool list must not include refunds.
        childSawRefundTool = JSON.stringify(context.messages).includes("refund_order");
        return fauxAssistantMessage(fauxToolCall("lookup_order", { id: "A7" }), { stopReason: "toolUse" });
      },
      fauxAssistantMessage("A7 has shipped."),
      fauxAssistantMessage("The analyst says A7 has shipped."),
    ]);
    const { detail, outcome } = await run(admin, "Ask the analyst about A7");
    const [delegate] = tools(detail.messages);

    expect(outcome.text).toBe("The analyst says A7 has shipped.");
    expect(childSawRefundTool).toBe(false);
    expect(delegate!.status).toBe("done");
    expect(delegate!.result?.text).toBe("A7 has shipped.");
    expect(delegate!.subagent?.agent).toBe("analyst");
    expect(delegate!.subagent?.status).toBe("done");
    expect(tools(delegate!.subagent!.messages)[0]).toMatchObject({ name: "lookup_order", status: "done" });
  });
});

describe("HTTP API", () => {
  it("creates a session and streams a run over SSE", async () => {
    setup();
    const app = createAgentRoutes(runtime, { auth: () => admin });
    faux.setResponses([fauxAssistantMessage([fauxText("Streaming works.")])]);

    const created = await app.request("/sessions", { method: "POST", body: "{}" });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const response = await app.request(`/sessions/${id}/runs`, {
      method: "POST",
      body: JSON.stringify({ prompt: "Test the stream" }),
    });
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events: AgentEvent[] = [];
    await readSseStream(response.body!, (message) => events.push(JSON.parse(message.data)));
    expect(events[0]!.type).toBe("run_start");
    expect(events.at(-1)).toMatchObject({ type: "run_end", status: "completed" });

    const config = (await (await app.request("/config")).json()) as { tools: { name: string }[]; user: AgentUser };
    expect(config.user.id).toBe("u1");
    expect(config.tools.map((t) => t.name)).toContain("refund_order");
  });

  it("maps errors to status codes", async () => {
    setup();
    const app = createAgentRoutes(runtime, { auth: (req) => (req.headers.get("authorization") ? admin : null) });
    expect((await app.request("/sessions")).status).toBe(401);
    const missing = await app.request("/sessions/nope", { headers: { authorization: "x" } });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: "not_found" });
  });

  it("hides other users' sessions", async () => {
    setup();
    faux.setResponses([fauxAssistantMessage("hi")]);
    const { sessionId } = await run(admin, "private");
    await expect(runtime.getSession(support, sessionId)).rejects.toMatchObject({ status: 404 });
    expect(await runtime.listSessions(support)).toEqual([]);
  });
});

describe("scheduler", () => {
  it("validates cron, runs on demand and records the result", async () => {
    setup({ schedules: [] });
    await runtime.start();
    await expect(
      runtime.scheduler!.create({ name: "Bad", prompt: "x", cron: "every tuesday" }, admin, "user"),
    ).rejects.toMatchObject({ status: 400 });

    const schedule = await runtime.scheduler!.create({ name: "Digest", prompt: "Summarize", cron: "0 9 * * 1" }, admin, "user");
    expect(schedule.nextRunAt).toBeGreaterThan(Date.now());

    faux.setResponses([fauxAssistantMessage("All quiet.")]);
    const finished = new Promise<string>((resolve) => {
      runtime.subscribe(admin, (event) => {
        if (event.type === "schedule_run" && event.status === "completed") resolve(event.sessionId);
      });
    });
    runtime.scheduler!.runNow(schedule.id, admin);
    const sessionId = await finished;
    const session = await runtime.getSession(admin, sessionId);
    expect(session.source).toBe("schedule");
    expect(session.messages.at(-1)!.parts).toEqual([{ type: "text", text: "All quiet." }]);
    expect(runtime.scheduler!.list(admin)[0]!.lastRun?.status).toBe("completed");
    expect(runtime.scheduler!.list(support)).toEqual([]);
  });
});
