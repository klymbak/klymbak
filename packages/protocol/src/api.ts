import type { ApprovalView, ChatMessage, ModelRef, ThinkingLevel, ToolSource, UsageInfo } from "./messages.ts";

export interface AgentUserInfo {
  id: string;
  name: string;
  roles: string[];
}

export type SessionSource = "chat" | "schedule" | "api";

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  source: SessionSource;
  scheduleId?: string;
  model?: ModelRef;
  running: boolean;
  /** Set on scheduled sessions until the owner opens them. */
  unread?: boolean;
  preview?: string;
  usage?: UsageInfo;
}

export interface SessionDetail extends SessionSummary {
  messages: ChatMessage[];
  thinkingLevel?: ThinkingLevel;
  activeRunId?: string;
  /** Tools the user chose to always allow in this session. */
  allowedTools: string[];
}

export interface ModelInfo {
  provider: string;
  providerName: string;
  id: string;
  name: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  input: string[];
  /** USD per million tokens. */
  cost?: { input: number; output: number };
  thinkingLevels: ThinkingLevel[];
  local?: boolean;
}

export interface ToolInfo {
  name: string;
  label: string;
  description: string;
  source: ToolSource;
  server?: string;
  approval: "never" | "always" | "conditional";
  readOnly?: boolean;
}

export interface SubagentInfo {
  name: string;
  description: string;
  tools: string[];
  model?: ModelRef;
}

export interface SkillInfo {
  name: string;
  description: string;
}

export interface McpServerInfo {
  name: string;
  transport: "stdio" | "http";
  target: string;
  status: "connecting" | "connected" | "error" | "disabled";
  error?: string;
  tools: string[];
  /** Added at runtime through the API rather than in server config. */
  runtime: boolean;
}

/** A resource an MCP server lists, which a person can mention in a message with @. */
export interface McpResourceInfo {
  /** The MCP server that lists it. */
  server: string;
  uri: string;
  /** The resource's title, or its name when it has none. */
  name: string;
  description?: string;
  mimeType?: string;
}

/** A family of resources an MCP server addresses by URI template (`orders://{id}`), mentioned with @ and a value for each variable. */
export interface McpResourceTemplateInfo {
  /** The MCP server that offers it. */
  server: string;
  uriTemplate: string;
  /** The template's title, or its name when it has none. */
  name: string;
  description?: string;
  mimeType?: string;
  /** The server suggests values for the variables (MCP completions). */
  completes?: boolean;
}

export interface McpPromptArgument {
  name: string;
  title?: string;
  description?: string;
  required?: boolean;
}

/** A prompt an MCP server offers, which a person can start a message with by typing /. */
export interface McpPromptInfo {
  /** The MCP server that offers it. */
  server: string;
  name: string;
  title?: string;
  description?: string;
  arguments: McpPromptArgument[];
  /** The server suggests values for the arguments (MCP completions). */
  completes?: boolean;
}

/** An MCP resource to read into a message: a listed one by `uri`, or one from a `template` with values for its variables. */
export interface McpResourceRef {
  server: string;
  uri?: string;
  template?: string;
  variables?: Record<string, string>;
}

/** Asks an MCP server for values that fit a prompt's argument or a resource template's variable, as the person types. */
export interface McpCompleteRequest {
  server: string;
  /** The prompt's name, for one of its arguments. */
  prompt?: string;
  /** The resource template, for one of its variables. */
  template?: string;
  /** The argument or variable. */
  argument: string;
  /** What the person has typed so far. */
  value: string;
  /** Values already given for the others. */
  context?: Record<string, string>;
}

/** An MCP prompt to start a message with, and its arguments. */
export interface McpPromptRef {
  server: string;
  name: string;
  arguments?: Record<string, string>;
}

export interface ScheduleRunInfo {
  at: number;
  status: "completed" | "aborted" | "error";
  sessionId: string;
  summary?: string;
}

export interface ScheduleInfo {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  timezone?: string;
  /** Subagent that runs the task. Defaults to the main agent. */
  agent?: string;
  enabled: boolean;
  source: "config" | "user" | "agent";
  ownerId?: string;
  nextRunAt?: number;
  running: boolean;
  lastRun?: ScheduleRunInfo;
}

export interface AppInfo {
  name: string;
  description?: string;
  suggestions?: string[];
}

export interface AgentConfigInfo {
  app: AppInfo;
  user: AgentUserInfo;
  models: ModelInfo[];
  defaultModel?: ModelRef;
  tools: ToolInfo[];
  subagents: SubagentInfo[];
  /** Procedures and house rules the agent loads when a task calls for them. */
  skills: SkillInfo[];
  mcpServers: McpServerInfo[];
  /** MCP resources the person can mention with @. */
  resources: McpResourceInfo[];
  /** MCP resource templates the person can mention with @, giving a value for each variable. */
  resourceTemplates: McpResourceTemplateInfo[];
  /** MCP prompts the person can start a message with, by typing /. */
  prompts: McpPromptInfo[];
  features: {
    schedules: boolean;
    steering: boolean;
    runtimeMcp: boolean;
    attachments: boolean;
  };
}

export interface CreateSessionRequest {
  title?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
}

export interface UpdateSessionRequest {
  title?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  unread?: boolean;
}

export interface RunRequest {
  prompt: string;
  images?: { mimeType: string; data: string }[];
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  /**
   * What the person has open in the host app (the record on screen, the selected rows), for the
   * model only. It is added to this message and never shown in the transcript.
   */
  context?: string;
  /** MCP resources mentioned with @. The server reads them and adds their contents to this message, for the model. */
  resources?: McpResourceRef[];
  /** An MCP prompt chosen with /. The server gets it with these arguments, and its text opens this message. */
  mcpPrompt?: McpPromptRef;
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
  /** Allow this tool without asking for the rest of the session. */
  remember?: boolean;
  /** New values for the approval's `fields`, by name, when approving. The call runs with them. */
  edits?: Record<string, string>;
}

/** An approval an unattended run left waiting, as the approval inbox lists it for someone who may decide it. */
export interface ApprovalInboxItem {
  sessionId: string;
  sessionTitle: string;
  source: SessionSource;
  approval: ApprovalView;
  /** The tool the call is for. */
  tool: string;
  /** Its name in the person's language. */
  label: string;
  args?: unknown;
  /** When the run stopped to wait. */
  createdAt: number;
}

export interface CreateScheduleRequest {
  name: string;
  prompt: string;
  cron: string;
  timezone?: string;
  agent?: string;
  enabled?: boolean;
}

export interface UpdateScheduleRequest {
  name?: string;
  prompt?: string;
  cron?: string;
  timezone?: string;
  enabled?: boolean;
}

export interface AddMcpServerRequest {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export interface ApiError {
  error: string;
  code?: string;
}
