import type { ChatMessage, MessagePart, ModelRef, ToolPart, UsageInfo } from "./messages.ts";
import type { McpServerInfo, ScheduleInfo, SessionDetail, SessionSummary } from "./api.ts";

/** Fields of a tool part that change while it runs. */
export type ToolPatch = Partial<Omit<ToolPart, "type" | "toolCallId">>;

export type RunStatus = "completed" | "aborted" | "error";

/**
 * Events streamed (as SSE) while an agent run is in progress.
 * `applyEvent` in reducer.ts folds them into a ChatMessage[] transcript.
 */
export type AgentEvent =
  | { type: "snapshot"; session: SessionDetail }
  | { type: "run_start"; runId: string; sessionId: string; model: ModelRef; at: number }
  | { type: "message_start"; message: ChatMessage }
  | { type: "part_start"; messageId: string; index: number; part: MessagePart }
  | { type: "part_delta"; messageId: string; index: number; delta: string }
  /** Authoritative final state of a message. Tool parts merge with their live state. */
  | { type: "message_end"; message: ChatMessage }
  | { type: "tool_update"; toolCallId: string; patch: ToolPatch }
  /** An event from a subagent, scoped to the delegate tool call that started it. */
  | { type: "subagent_event"; toolCallId: string; event: AgentEvent }
  | { type: "run_end"; runId: string; status: RunStatus; error?: string; usage?: UsageInfo }
  | { type: "session_update"; session: SessionSummary };

/** Events on the global notification stream (GET /events). */
export type NotificationEvent =
  | { type: "hello"; at: number }
  | {
      type: "schedule_run";
      scheduleId: string;
      name: string;
      sessionId: string;
      status: RunStatus | "started";
      summary?: string;
      at: number;
    }
  | { type: "schedule_update"; schedule: ScheduleInfo }
  | { type: "schedule_delete"; scheduleId: string }
  | { type: "session_update"; session: SessionSummary }
  | { type: "session_delete"; sessionId: string }
  | { type: "mcp_update"; server: McpServerInfo }
  | { type: "approval_pending"; sessionId: string; approvalId: string; title: string }
  /** Someone decided an approval that was waiting, so it leaves everyone's inbox. */
  | { type: "approval_decided"; sessionId: string; approvalId: string };
