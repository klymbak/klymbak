import { describe, expect, it } from "vitest";
import type { AgentEvent, ChatMessage, ToolPart } from "./index.ts";
import { applyEvent, createSseParser, pendingApprovals, touchedMessages } from "./index.ts";

const assistant = (id: string): ChatMessage => ({
  id,
  role: "assistant",
  parts: [],
  createdAt: 1,
  status: "streaming",
});

function run(events: AgentEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const event of events) applyEvent(messages, event);
  return messages;
}

describe("applyEvent", () => {
  it("streams text and thinking into indexed parts", () => {
    const messages = run([
      { type: "message_start", message: assistant("a1") },
      { type: "part_start", messageId: "a1", index: 0, part: { type: "thinking", text: "" } },
      { type: "part_delta", messageId: "a1", index: 0, delta: "Let me " },
      { type: "part_delta", messageId: "a1", index: 0, delta: "check." },
      { type: "part_start", messageId: "a1", index: 1, part: { type: "text", text: "" } },
      { type: "part_delta", messageId: "a1", index: 1, delta: "Hello" },
    ]);
    expect(messages[0]!.parts).toEqual([
      { type: "thinking", text: "Let me check." },
      { type: "text", text: "Hello" },
    ]);
  });

  it("keeps live tool state when the final message arrives", () => {
    const messages = run([
      { type: "message_start", message: assistant("a1") },
      {
        type: "part_start",
        messageId: "a1",
        index: 0,
        part: { type: "tool", toolCallId: "t1", name: "refund_order", status: "streaming" },
      },
      { type: "tool_update", toolCallId: "t1", patch: { status: "running", startedAt: 5 } },
      {
        type: "message_end",
        message: {
          ...assistant("a1"),
          status: "done",
          parts: [{ type: "tool", toolCallId: "t1", name: "refund_order", status: "pending", args: { id: 7 } }],
        },
      },
      {
        type: "tool_update",
        toolCallId: "t1",
        patch: { status: "done", result: { text: "ok", isError: false }, durationMs: 12 },
      },
    ]);
    const tool = messages[0]!.parts[0] as ToolPart;
    expect(tool.status).toBe("done");
    expect(tool.args).toEqual({ id: 7 });
    expect(tool.startedAt).toBe(5);
    expect(messages[0]!.status).toBe("done");
  });

  it("nests subagent transcripts under the delegating tool call", () => {
    const messages = run([
      { type: "message_start", message: assistant("a1") },
      {
        type: "part_start",
        messageId: "a1",
        index: 0,
        part: { type: "tool", toolCallId: "t1", name: "delegate_task", status: "running" },
      },
      {
        type: "tool_update",
        toolCallId: "t1",
        patch: { subagent: { agent: "analyst", task: "sales", status: "running", messages: [] } },
      },
      { type: "subagent_event", toolCallId: "t1", event: { type: "message_start", message: assistant("s1") } },
      {
        type: "subagent_event",
        toolCallId: "t1",
        event: {
          type: "part_start",
          messageId: "s1",
          index: 0,
          part: { type: "tool", toolCallId: "t2", name: "issue_credit", status: "pending" },
        },
      },
      {
        type: "subagent_event",
        toolCallId: "t1",
        event: {
          type: "tool_update",
          toolCallId: "t2",
          patch: {
            status: "awaiting_approval",
            approval: { id: "ap1", title: "Issue credit", status: "pending" },
          },
        },
      },
    ]);
    const pending = pendingApprovals(messages);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.path).toEqual(["analyst"]);
    expect(pending[0]!.approval.id).toBe("ap1");
  });

  it("closes in-flight work when a run is aborted", () => {
    const messages = run([
      { type: "message_start", message: assistant("a1") },
      {
        type: "part_start",
        messageId: "a1",
        index: 0,
        part: { type: "tool", toolCallId: "t1", name: "x", status: "awaiting_approval" },
      },
      {
        type: "tool_update",
        toolCallId: "t1",
        patch: { approval: { id: "ap", title: "x", status: "pending" } },
      },
      { type: "run_end", runId: "r", status: "aborted" },
    ]);
    const tool = messages[0]!.parts[0] as ToolPart;
    expect(messages[0]!.status).toBe("aborted");
    expect(tool.status).toBe("error");
    expect(tool.approval?.status).toBe("expired");
  });
});

describe("touchedMessages", () => {
  it("names every message applyEvent changes, and leaves finished ones out", () => {
    const done: ChatMessage = { id: "old", role: "assistant", parts: [{ type: "text", text: "Earlier answer" }], createdAt: 1, status: "done" };
    const messages: ChatMessage[] = [done];
    const events: AgentEvent[] = [
      { type: "run_start", runId: "r", sessionId: "s", model: { provider: "p", id: "m" }, at: 1 },
      { type: "message_start", message: { id: "u", role: "user", parts: [{ type: "text", text: "Go" }], createdAt: 2, status: "done" } },
      { type: "message_start", message: assistant("a") },
      { type: "part_start", messageId: "a", index: 0, part: { type: "text", text: "" } },
      { type: "part_delta", messageId: "a", index: 0, delta: "Working" },
      { type: "part_start", messageId: "a", index: 1, part: { type: "tool", toolCallId: "t1", name: "delegate_task", status: "pending" } },
      { type: "tool_update", toolCallId: "t1", patch: { status: "running" } },
      { type: "subagent_event", toolCallId: "t1", event: { type: "message_start", message: assistant("sub") } },
      // A tool call the provider never announced attaches to the latest assistant message.
      { type: "tool_update", toolCallId: "t2", patch: { name: "list_orders", status: "running" } },
      { type: "message_end", message: { ...assistant("a"), status: "done", parts: [{ type: "text", text: "Working" }] } },
      { type: "run_end", runId: "r", status: "aborted" },
    ];
    for (const event of events) {
      const touched = touchedMessages(messages, event);
      const before = new Map(messages.map((m) => [m.id, JSON.stringify(m)]));
      applyEvent(messages, event);
      const changed = messages.filter((m) => before.get(m.id) !== JSON.stringify(m)).map((m) => m.id);
      if (touched !== "all") expect(touched, event.type).toEqual(expect.arrayContaining(changed));
      expect(touched, event.type).not.toContain("old");
    }
    expect(messages[0]).toBe(done);
  });
});

describe("createSseParser", () => {
  it("handles events split across chunks and CRLF line endings", () => {
    const seen: string[] = [];
    const parser = createSseParser((m) => seen.push(`${m.event ?? "message"}:${m.data}`));
    parser.push(": keepalive\r\n\r\nevent: agent\r\ndata: {\"a\"");
    parser.push(":1}\r");
    parser.push("\n\r\ndata: line1\ndata: line2\n\n");
    parser.flush();
    expect(seen).toEqual(['agent:{"a":1}', "message:line1\nline2"]);
  });
});
