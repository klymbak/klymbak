import type { UiBlock } from "./ui.ts";

export interface ModelRef {
  provider: string;
  id: string;
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface UsageInfo {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  /** USD, as reported by the provider catalog. */
  cost: number;
}

export interface TextPart {
  type: "text";
  text: string;
}

export interface ThinkingPart {
  type: "thinking";
  text: string;
  redacted?: boolean;
}

export interface ImagePart {
  type: "image";
  mimeType: string;
  /** Base64 data without the data: prefix. */
  data: string;
}

/**
 * Lifecycle of a tool call as the user sees it.
 *
 * streaming → pending → (awaiting_approval →) running → done | error
 * A call can also end as `denied` (a person said no) or `blocked` (a policy hook said no).
 */
export type ToolStatus =
  | "streaming"
  | "pending"
  | "awaiting_approval"
  | "running"
  | "done"
  | "error"
  | "denied"
  | "blocked";

export type ToolSource = "local" | "mcp" | "builtin" | "subagent";

export interface ToolResultView {
  text: string;
  ui?: UiBlock[];
  isError: boolean;
}

export type Risk = "low" | "medium" | "high";

/** An argument a person may change before approving, such as the text of a drafted reply. */
export interface ApprovalField {
  /** The argument's name. */
  name: string;
  label: string;
  /** The value the call has: the agent's draft, or once approved, what the call ran with. */
  value: string;
  /** A text area rather than a single line. */
  multiline?: boolean;
}

export interface ApprovalView {
  id: string;
  title: string;
  description?: string;
  risk?: Risk;
  status: "pending" | "approved" | "denied" | "expired";
  decidedBy?: string;
  reason?: string;
  /** Approving may also allow this tool for the rest of the conversation. */
  rememberable?: boolean;
  /** An unattended run ended to wait for this decision; deciding resumes it, however much later. */
  waits?: boolean;
  /** Arguments the person deciding may edit first. The call runs with their version. */
  fields?: ApprovalField[];
  /** The person who approved changed some of the fields. */
  edited?: boolean;
}

export interface SubagentView {
  agent: string;
  task: string;
  status: "running" | "done" | "error";
  messages: ChatMessage[];
}

export interface ToolPart {
  type: "tool";
  toolCallId: string;
  name: string;
  label?: string;
  source?: ToolSource;
  /** MCP server that provides the tool. */
  server?: string;
  args?: unknown;
  status: ToolStatus;
  progress?: string;
  result?: ToolResultView;
  approval?: ApprovalView;
  subagent?: SubagentView;
  startedAt?: number;
  durationMs?: number;
}

/** An MCP resource the person mentioned with @. The model read its contents; people see its name. */
export interface ResourcePart {
  type: "resource";
  /** The MCP server that lists it. */
  server: string;
  uri: string;
  name: string;
  mimeType?: string;
}

/** An MCP prompt the person started the message with, by typing /. The model read its text; people see its name. */
export interface PromptPart {
  type: "prompt";
  /** The MCP server that offers it. */
  server: string;
  name: string;
  title?: string;
  arguments?: Record<string, string>;
}

export type MessagePart = TextPart | ThinkingPart | ImagePart | ToolPart | ResourcePart | PromptPart;

export type MessageRole = "user" | "assistant" | "notice";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt: number;
  status: "streaming" | "done" | "error" | "aborted";
  model?: ModelRef;
  usage?: UsageInfo;
  error?: string;
  /** Notices only. */
  level?: "info" | "warning" | "error";
  /** Who produced a user message: a person, a hook, a schedule or a steering interjection. */
  origin?: "user" | "hook" | "schedule" | "steer";
}

export function messageText(message: ChatMessage): string {
  return message.parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function emptyUsage(): UsageInfo {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
}

export function addUsage(target: UsageInfo, add: UsageInfo | undefined): UsageInfo {
  if (!add) return target;
  target.input += add.input;
  target.output += add.output;
  target.cacheRead += add.cacheRead;
  target.cacheWrite += add.cacheWrite;
  target.totalTokens += add.totalTokens;
  target.cost += add.cost;
  return target;
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.provider}/${ref.id}`;
}

/** Parses "provider/model-id". Model ids may contain slashes (e.g. "lmstudio/qwen/qwen3-8b"). */
export function parseModelRef(value: string): ModelRef | undefined {
  const index = value.indexOf("/");
  if (index <= 0 || index === value.length - 1) return undefined;
  return { provider: value.slice(0, index), id: value.slice(index + 1) };
}
