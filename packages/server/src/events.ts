import { randomUUID } from "node:crypto";
import type { Agent, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolCall, Usage, UserMessage } from "@earendil-works/pi-ai";
import type { AgentEvent, ChatMessage, MessagePart, ToolPart, ToolSource, UsageInfo } from "@klymbak/protocol";
import { contentText, type ToolResultDetails } from "./tool.ts";

/** Text blocks starting with this tag carry model-only context and are hidden from the transcript. */
export const SYSTEM_CONTEXT_TAG = "<system-context>";

export interface ToolMeta {
  label?: string;
  source?: ToolSource;
  server?: string;
}

export interface EventMapperOptions {
  emit(event: AgentEvent): void;
  toolMeta(name: string): ToolMeta | undefined;
  /** Calls refused by the harness, so they render as denied/blocked rather than failed. */
  blocked: Map<string, "denied" | "blocked">;
  /** When each call was allowed to start, for durations that exclude approval wait time. */
  startedAt: Map<string, number>;
  userOrigin(message: UserMessage, index: number): ChatMessage["origin"];
  onAssistantEnd?(message: AssistantMessage): void;
}

const ARGS_THROTTLE_MS = 120;

/** Subscribes to a pi Agent and re-emits its events in the klymbak wire protocol. */
export function attachEventMapper(agent: Agent, options: EventMapperOptions): () => void {
  const { emit } = options;
  let assistantId: string | undefined;
  let userIndex = 0;
  const lastArgsEmit = new Map<string, number>();

  return agent.subscribe((event) => {
    switch (event.type) {
      case "message_start": {
        const message = event.message;
        if (message.role === "user") {
          const chat = userToChat(message, options.userOrigin(message, userIndex++));
          if (chat) emit({ type: "message_start", message: chat });
        } else if (message.role === "assistant") {
          assistantId = randomUUID();
          emit({
            type: "message_start",
            message: {
              id: assistantId,
              role: "assistant",
              parts: [],
              createdAt: message.timestamp || Date.now(),
              status: "streaming",
              model: { provider: message.provider, id: message.model },
            },
          });
        }
        return;
      }

      case "message_update": {
        if (!assistantId) return;
        const update = event.assistantMessageEvent;
        const messageId = assistantId;
        switch (update.type) {
          case "text_start":
            emit({ type: "part_start", messageId, index: update.contentIndex, part: { type: "text", text: "" } });
            return;
          case "thinking_start":
            emit({ type: "part_start", messageId, index: update.contentIndex, part: { type: "thinking", text: "" } });
            return;
          case "text_delta":
          case "thinking_delta":
            emit({ type: "part_delta", messageId, index: update.contentIndex, delta: update.delta });
            return;
          case "toolcall_start": {
            const block = update.partial.content[update.contentIndex];
            if (block?.type === "toolCall" && block.id) {
              emit({ type: "part_start", messageId, index: update.contentIndex, part: toolPart(block, "streaming", options) });
            }
            return;
          }
          case "toolcall_delta": {
            const block = update.partial.content[update.contentIndex];
            if (block?.type !== "toolCall" || !block.id) return;
            const now = Date.now();
            if (now - (lastArgsEmit.get(block.id) ?? 0) < ARGS_THROTTLE_MS) return;
            lastArgsEmit.set(block.id, now);
            emit({ type: "tool_update", toolCallId: block.id, patch: { args: structuredClone(block.arguments) } });
            return;
          }
          case "toolcall_end":
            lastArgsEmit.delete(update.toolCall.id);
            emit({
              type: "tool_update",
              toolCallId: update.toolCall.id,
              patch: { args: update.toolCall.arguments, status: "pending" },
            });
            return;
          default:
            return;
        }
      }

      case "message_end": {
        const message = event.message;
        if (message.role !== "assistant" || !assistantId) return;
        emit({ type: "message_end", message: assistantToChat(message, assistantId, options) });
        options.onAssistantEnd?.(message);
        assistantId = undefined;
        return;
      }

      case "tool_execution_start":
        emit({
          type: "tool_update",
          toolCallId: event.toolCallId,
          patch: { name: event.toolName, status: "pending", ...options.toolMeta(event.toolName) },
        });
        return;

      case "tool_execution_update": {
        const partial = event.partialResult as AgentToolResult<ToolResultDetails> | undefined;
        const text = partial?.details?.progress ?? contentText(partial?.content);
        if (text) emit({ type: "tool_update", toolCallId: event.toolCallId, patch: { progress: text } });
        return;
      }

      case "tool_execution_end": {
        const result = event.result as AgentToolResult<ToolResultDetails> | undefined;
        const refused = options.blocked.get(event.toolCallId);
        options.blocked.delete(event.toolCallId);
        const started = options.startedAt.get(event.toolCallId);
        options.startedAt.delete(event.toolCallId);
        emit({
          type: "tool_update",
          toolCallId: event.toolCallId,
          patch: {
            status: refused ?? (event.isError ? "error" : "done"),
            progress: undefined,
            durationMs: started ? Date.now() - started : event.durationMs,
            result: {
              text: contentText(result?.content),
              ui: result?.details?.ui?.length ? result.details.ui : undefined,
              isError: event.isError,
            },
          },
        });
        return;
      }

      default:
        return;
    }
  });
}

function toolPart(block: ToolCall, status: ToolPart["status"], options: EventMapperOptions): ToolPart {
  return {
    type: "tool",
    toolCallId: block.id,
    name: block.name,
    args: structuredClone(block.arguments),
    status,
    ...options.toolMeta(block.name),
  };
}

export function userToChat(message: UserMessage, origin: ChatMessage["origin"]): ChatMessage | undefined {
  const parts: MessagePart[] = [];
  if (typeof message.content === "string") {
    if (!message.content.startsWith(SYSTEM_CONTEXT_TAG)) parts.push({ type: "text", text: message.content });
  } else {
    for (const block of message.content) {
      if (block.type === "text" && !block.text.startsWith(SYSTEM_CONTEXT_TAG)) parts.push({ type: "text", text: block.text });
      else if (block.type === "image") parts.push({ type: "image", mimeType: block.mimeType, data: block.data });
    }
  }
  if (parts.length === 0) return undefined;
  return { id: randomUUID(), role: "user", parts, createdAt: message.timestamp || Date.now(), status: "done", origin };
}

export function assistantToChat(message: AssistantMessage, id: string, options: Pick<EventMapperOptions, "toolMeta">): ChatMessage {
  const parts: MessagePart[] = message.content.map((block): MessagePart => {
    if (block.type === "text") return { type: "text", text: block.text };
    if (block.type === "thinking") return { type: "thinking", text: block.thinking, redacted: block.redacted };
    return {
      type: "tool",
      toolCallId: block.id,
      name: block.name,
      args: block.arguments,
      status: "pending",
      ...options.toolMeta(block.name),
    };
  });
  return {
    id,
    role: "assistant",
    parts,
    createdAt: message.timestamp || Date.now(),
    status: message.stopReason === "error" ? "error" : message.stopReason === "aborted" ? "aborted" : "done",
    model: { provider: message.provider, id: message.model },
    usage: toUsageInfo(message.usage),
    error: message.errorMessage,
  };
}

export function toUsageInfo(usage: Usage | undefined): UsageInfo | undefined {
  if (!usage) return undefined;
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
    cost: usage.cost?.total ?? 0,
  };
}
