import type { AgentEvent, RunStatus } from "./events.ts";
import type { ApprovalView, ChatMessage, MessagePart, ToolPart } from "./messages.ts";

const TERMINAL_TOOL_STATUSES = new Set(["done", "error", "denied", "blocked"]);

/** Tool part fields that only the live stream knows about; `message_end` must not wipe them. */
const LIVE_TOOL_FIELDS = [
  "status",
  "progress",
  "result",
  "approval",
  "subagent",
  "startedAt",
  "durationMs",
  "source",
  "server",
  "label",
] as const;

/**
 * Folds one stream event into a transcript, mutating it in place.
 *
 * In-place mutation keeps Vue's reactivity cheap (only touched parts re-render) and lets
 * the server maintain the same view of a session that the browser has.
 */
export function applyEvent(messages: ChatMessage[], event: AgentEvent): void {
  switch (event.type) {
    case "snapshot": {
      messages.splice(0, messages.length, ...structuredClone(event.session.messages));
      return;
    }
    case "message_start": {
      const index = messages.findIndex((m) => m.id === event.message.id);
      const message = structuredClone(event.message);
      if (index >= 0) messages[index] = message;
      else messages.push(message);
      return;
    }
    case "part_start": {
      const message = findMessage(messages, event.messageId);
      if (!message) return;
      const part = structuredClone(event.part);
      const existing = message.parts[event.index];
      if (existing && existing.type === "tool" && part.type === "tool" && existing.toolCallId === part.toolCallId) {
        mergeToolPart(existing, part);
        return;
      }
      while (message.parts.length < event.index) message.parts.push({ type: "text", text: "" });
      message.parts[event.index] = part;
      return;
    }
    case "part_delta": {
      const message = findMessage(messages, event.messageId);
      if (!message) return;
      let part = message.parts[event.index];
      if (!part) {
        while (message.parts.length < event.index) message.parts.push({ type: "text", text: "" });
        part = { type: "text", text: "" };
        message.parts[event.index] = part;
      }
      if (part.type === "text" || part.type === "thinking") part.text += event.delta;
      return;
    }
    case "message_end": {
      const incoming = structuredClone(event.message);
      const existing = findMessage(messages, incoming.id);
      if (!existing) {
        messages.push(incoming);
        return;
      }
      const merged: MessagePart[] = incoming.parts.map((part) => {
        if (part.type !== "tool") return part;
        const live = existing.parts.find(
          (p): p is ToolPart => p.type === "tool" && p.toolCallId === part.toolCallId,
        );
        if (!live) return part;
        return mergeToolPart(live, part, true);
      });
      // Keep tool parts the final message does not mention (defensive; providers should not drop them).
      for (const part of existing.parts) {
        if (part.type === "tool" && !merged.some((p) => p.type === "tool" && p.toolCallId === part.toolCallId)) {
          merged.push(part);
        }
      }
      existing.parts = merged;
      existing.status = incoming.status;
      existing.usage = incoming.usage ?? existing.usage;
      existing.error = incoming.error;
      existing.model = incoming.model ?? existing.model;
      return;
    }
    case "tool_update": {
      const part = findToolPart(messages, event.toolCallId);
      if (part) {
        Object.assign(part, structuredClone(event.patch));
        return;
      }
      // The provider skipped toolcall_start; attach the call to the latest assistant message.
      const host = [...messages].reverse().find((m) => m.role === "assistant");
      if (!host || !event.patch.name) return;
      host.parts.push({
        type: "tool",
        toolCallId: event.toolCallId,
        name: event.patch.name,
        status: "pending",
        ...structuredClone(event.patch),
      });
      return;
    }
    case "subagent_event": {
      const part = findToolPart(messages, event.toolCallId);
      if (!part) return;
      part.subagent ??= { agent: "subagent", task: "", status: "running", messages: [] };
      applyEvent(part.subagent.messages, event.event);
      if (event.event.type === "run_end") {
        part.subagent.status = event.event.status === "completed" ? "done" : "error";
      }
      return;
    }
    case "run_end": {
      finalizeTranscript(messages, event.status);
      return;
    }
    case "run_start":
    case "session_update":
      return;
  }
}

/**
 * The ids of the top-level messages `applyEvent` will change for this event, or "all" when it replaces
 * the transcript. Call it before applyEvent. Lets a UI without deep reactivity (React) re-render only
 * those messages; keep it in step with applyEvent.
 */
export function touchedMessages(messages: ChatMessage[], event: AgentEvent): string[] | "all" {
  switch (event.type) {
    case "snapshot":
      return "all";
    case "message_start":
    case "message_end":
      return [event.message.id];
    case "part_start":
    case "part_delta":
      return [event.messageId];
    case "tool_update":
    case "subagent_event": {
      const owner =
        messageWithTool(messages, event.toolCallId) ??
        (event.type === "tool_update" ? [...messages].reverse().find((m) => m.role === "assistant") : undefined);
      return owner ? [owner.id] : [];
    }
    case "run_end":
      return messages.filter(needsFinalizing).map((m) => m.id);
    case "run_start":
    case "session_update":
      return [];
  }
}

function messageWithTool(messages: ChatMessage[], toolCallId: string): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.parts.some((p) => p.type === "tool" && p.toolCallId === toolCallId)) return messages[i];
  }
  return undefined;
}

/** Whether finalizeTranscript may change this message. */
function needsFinalizing(message: ChatMessage): boolean {
  return (
    message.status === "streaming" ||
    message.parts.some((p) => p.type === "tool" && (!TERMINAL_TOOL_STATUSES.has(p.status) || p.subagent !== undefined))
  );
}

/** Closes anything still marked as in-flight after a run ends (aborts, crashes, lost events). */
export function finalizeTranscript(messages: ChatMessage[], status: RunStatus): void {
  for (const message of messages) {
    if (message.status === "streaming") {
      message.status = status === "completed" ? "done" : status === "aborted" ? "aborted" : "error";
    }
    for (const part of message.parts) {
      if (part.type !== "tool") continue;
      if (!TERMINAL_TOOL_STATUSES.has(part.status)) {
        part.status = "error";
        part.result ??= {
          text: status === "aborted" ? "Stopped before the tool finished." : "The run ended before the tool finished.",
          isError: true,
        };
        if (part.approval?.status === "pending") part.approval.status = "expired";
      }
      if (part.subagent) {
        finalizeTranscript(part.subagent.messages, status);
        if (part.subagent.status === "running") part.subagent.status = status === "completed" ? "done" : "error";
      }
    }
  }
}

export function findMessage(messages: ChatMessage[], id: string): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.id === id) return messages[i];
  }
  return undefined;
}

/** Finds a top-level tool part (not inside a subagent) by tool call id, newest first. */
export function findToolPart(messages: ChatMessage[], toolCallId: string): ToolPart | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]!.parts;
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j]!;
      if (part.type === "tool" && part.toolCallId === toolCallId) return part;
    }
  }
  return undefined;
}

export interface PendingApproval {
  approval: ApprovalView;
  tool: ToolPart;
  /** Subagent names from the top-level message down to the tool, empty for the main agent. */
  path: string[];
}

/** Every approval still waiting for a decision, including those raised inside subagents. */
export function pendingApprovals(messages: ChatMessage[], path: string[] = []): PendingApproval[] {
  const found: PendingApproval[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool") continue;
      if (part.approval?.status === "pending") found.push({ approval: part.approval, tool: part, path });
      if (part.subagent) found.push(...pendingApprovals(part.subagent.messages, [...path, part.subagent.agent]));
    }
  }
  return found;
}

function mergeToolPart(live: ToolPart, incoming: ToolPart, preferLive = false): ToolPart {
  if (preferLive) {
    for (const key of LIVE_TOOL_FIELDS) {
      if (live[key] !== undefined) (incoming as unknown as Record<string, unknown>)[key] = live[key];
    }
    if (incoming.args === undefined) incoming.args = live.args;
    return incoming;
  }
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) (live as unknown as Record<string, unknown>)[key] = value;
  }
  return live;
}
