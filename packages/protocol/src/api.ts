import type { ChatMessage, ModelRef, ThinkingLevel, ToolSource, UsageInfo } from "./messages.ts";

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
}

export interface ApprovalDecision {
  approved: boolean;
  reason?: string;
  /** Allow this tool without asking for the rest of the session. */
  remember?: boolean;
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
