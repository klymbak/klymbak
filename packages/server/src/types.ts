import type { Static, TSchema } from "@earendil-works/pi-ai";
import type {
  AgentEvent,
  AppInfo,
  ModelRef,
  Risk,
  RunStatus,
  SessionSource,
  ThinkingLevel,
  ToolSource,
  UiBlock,
  UsageInfo,
} from "@klymbak/protocol";
import type { AgentRuntime } from "./runtime.ts";

export type Awaitable<T> = T | Promise<T>;

/** The person (or service identity) an agent acts for. Tools receive it on every call. */
export interface AgentUser {
  id: string;
  name: string;
  roles: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

/** Who is calling, from where. Passed to tools, approval checks and hooks. */
export interface HookContext {
  user: AgentUser;
  sessionId: string;
  /** "main" for the top-level agent, otherwise the subagent's name. */
  agent: string;
  /** True when no person is watching (scheduled and API runs). Approvals are refused. */
  headless: boolean;
  source: SessionSource;
  runtime: AgentRuntime;
}

export interface ToolContext extends HookContext {
  toolCallId: string;
  signal: AbortSignal;
  /** Show a progress line on the tool card while the tool runs. */
  progress(text: string): void;
}

/**
 * What a tool returns.
 *
 * - `text` is what the model reads. When omitted, `data` is sent as JSON.
 * - `ui` blocks are rendered for the user and never sent to the model.
 * - `data` is also available to postToolUse hooks.
 */
export type ToolOutput =
  | string
  | {
      text?: string;
      data?: unknown;
      ui?: UiBlock | UiBlock[];
      isError?: boolean;
      images?: { data: string; mimeType: string }[];
    };

export interface ApprovalRequest {
  title: string;
  description?: string;
  risk?: Risk;
}

export type ApprovalPolicy<A> =
  | boolean
  | ((args: A, ctx: HookContext) => Awaitable<boolean | ApprovalRequest | undefined>);

export interface ToolDefinition<P extends TSchema = TSchema> {
  /** Unique, [A-Za-z0-9_-], at most 64 characters. */
  name: string;
  /** Human-friendly name for the tool card. */
  label?: string;
  /** Tells the model when and how to use the tool. This is the tool's most important field. */
  description: string;
  /** TypeBox schema (re-exported as `Type`). Arguments are validated before `execute` runs. */
  parameters: P;
  /** Ask a person before running. A function can decide per call (e.g. only refunds over $50). */
  approval?: ApprovalPolicy<Static<P>>;
  /** Only users with at least one of these roles get the tool. */
  roles?: string[];
  /** Marks tools that never change data. Used for subagent filters and the capabilities panel. */
  readOnly?: boolean;
  /** Run alone rather than in parallel with sibling tool calls. */
  sequential?: boolean;
  /** Text sent to the model is truncated beyond this many characters. Default 24k. */
  maxResultChars?: number;
  /** @internal set for MCP and built-in tools */
  source?: ToolSource;
  /** @internal MCP server name */
  server?: string;
  execute(args: Static<P>, ctx: ToolContext): Awaitable<ToolOutput>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export interface ToolResultForHooks {
  text: string;
  ui: UiBlock[];
  isError: boolean;
  /** Raw `data` returned by the tool, when it returned any. */
  data?: unknown;
}

export interface PreToolUseResult {
  /** deny blocks the call, ask requires a person's approval, allow skips the tool's own approval. */
  decision?: "allow" | "deny" | "ask";
  reason?: string;
  approval?: Partial<ApprovalRequest>;
}

export interface PostToolUseResult {
  text?: string;
  ui?: UiBlock[];
  isError?: boolean;
}

export interface UserPromptResult {
  /** Refuse the prompt with this explanation. */
  block?: string;
  /** Replace the prompt text. */
  prompt?: string;
  /** Extra context for the model only; the user does not see it. */
  context?: string;
}

/**
 * Lifecycle hooks, modelled on Claude Code's hook events.
 * Hooks run in the order they are registered. For preToolUse, any `deny` wins, then `ask`, then `allow`.
 */
export interface Hook {
  name: string;
  /** Limit preToolUse/postToolUse to these tools. */
  tools?: string[] | RegExp;
  /** Runs when a session's agent is created. Returned context is appended to the system prompt. */
  sessionStart?(input: { ctx: HookContext }): Awaitable<{ context?: string } | void>;
  userPromptSubmit?(input: { prompt: string; ctx: HookContext }): Awaitable<UserPromptResult | void>;
  preToolUse?(input: {
    tool: ToolDefinition<any>;
    args: any;
    toolCallId: string;
    ctx: HookContext;
  }): Awaitable<PreToolUseResult | void>;
  postToolUse?(input: {
    tool: ToolDefinition<any>;
    args: any;
    toolCallId: string;
    result: ToolResultForHooks;
    ctx: HookContext;
  }): Awaitable<PostToolUseResult | void>;
  /** Runs when the agent is about to stop. Return `continue` to send it one more instruction. */
  stop?(input: { text: string; turn: number; ctx: HookContext }): Awaitable<{ continue?: string } | void>;
  runEnd?(input: { status: RunStatus; usage: UsageInfo; error?: string; ctx: HookContext }): Awaitable<void>;
  /** Every stream event, for logging, analytics or audit trails. Must not throw. */
  onEvent?(event: AgentEvent, ctx: HookContext): void;
}

// ---------------------------------------------------------------------------
// Subagents and schedules
// ---------------------------------------------------------------------------

export interface SubagentDefinition {
  name: string;
  /** Shown to the main agent so it knows when to delegate. */
  description: string;
  systemPrompt: string;
  /** Tool names, or a filter. Defaults to every tool the user may use. */
  tools?: string[] | ((tool: ToolDefinition<any>) => boolean);
  /** "provider/model-id". Defaults to the parent's model. */
  model?: string;
  thinkingLevel?: ThinkingLevel;
  maxTurns?: number;
}

export interface ScheduleDefinition {
  id: string;
  name: string;
  /** Cron expression, e.g. "0 8 * * 1-5" for weekdays at 08:00. */
  cron: string;
  prompt: string;
  timezone?: string;
  /** Run as this subagent instead of the main agent. */
  agent?: string;
  model?: string;
  enabled?: boolean;
  /** Users with these roles see the results. Default ["admin"]. */
  audience?: string[];
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

/**
 * Written instructions for one kind of task: a procedure, a checklist, house rules. Only the
 * name and description are in the prompt; the agent loads the rest with use_skill when a task
 * calls for it. loadSkills() reads them from SKILL.md folders (Anthropic's Agent Skills format).
 */
export interface SkillDefinition {
  /** Lowercase letters, digits and single hyphens, at most 64 characters: "write-article". */
  name: string;
  /** What the skill covers and when to use it, at most 1024 characters. Always in the prompt. */
  description: string;
  /** The skill itself, in Markdown. */
  instructions: string;
  /** Only people with one of these roles see it. Default: everyone. */
  roles?: string[];
  /** Further documents the instructions refer to, by relative path: { "reference/tone.md": "…" }. */
  files?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface CustomModelConfig {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  vision?: boolean;
}

/** Any OpenAI-compatible endpoint: LM Studio, Ollama, vLLM, LiteLLM, an internal gateway... */
export interface OpenAICompatibleProviderConfig {
  id: string;
  name?: string;
  baseUrl: string;
  apiKey?: string;
  apiKeyEnv?: string;
  models?: (string | CustomModelConfig)[];
  /** Fetch the model list from the server. "lmstudio" uses LM Studio's richer /api/v0/models. */
  discover?: boolean | "lmstudio";
  /** Defaults for discovered or partially specified models. */
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  /** pi-ai OpenAI compatibility flags. */
  compat?: Record<string, unknown>;
  local?: boolean;
}

export interface ModelsConfig {
  /**
   * Built-in pi-ai provider ids to enable ("anthropic", "openai", "google", "openrouter", ...)
   * or provider objects. Providers only appear when their credentials are configured.
   * Default: every built-in provider.
   */
  providers?: (string | import("@earendil-works/pi-ai").Provider)[];
  custom?: OpenAICompatibleProviderConfig[];
  /** Glob patterns over "provider/model-id", e.g. ["anthropic/claude-*", "openai/gpt-5*"]. */
  allow?: string[];
  /** Preferred default models in order; the first available one wins. */
  default?: string | string[];
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

/** Selects MCP tools by their unprefixed name: all (true), none (false), a list, or a predicate. */
export type McpToolFilter = boolean | string[] | ((name: string) => boolean);

interface McpServerCommon {
  enabled?: boolean;
  /** Prefix for tool names. Defaults to the server name. */
  prefix?: string;
  /** Only load these tools (unprefixed names), or the ones a function accepts. */
  include?: string[] | ((name: string) => boolean);
  /** Never load these tools, or the ones a function matches. */
  exclude?: string[] | ((name: string) => boolean);
  /**
   * true: every tool asks for approval. A list: only these tools. A function decides per tool.
   * Names are the server's own, without the prefix. Default: tools annotated destructiveHint.
   */
  approval?: McpToolFilter;
  /** Tools that never change data: true for all, a list, or a function. Default: readOnlyHint. */
  readOnly?: McpToolFilter;
  roles?: string[];
  timeoutMs?: number;
}

export interface McpStdioServerConfig extends McpServerCommon {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpHttpServerConfig extends McpServerCommon {
  url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig;

// ---------------------------------------------------------------------------
// Runtime config
// ---------------------------------------------------------------------------

export interface Logger {
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export interface AgentRuntimeConfig {
  app?: AppInfo;
  /** Base instructions. A function receives the user so prompts can vary by role. */
  systemPrompt: string | ((ctx: { user: AgentUser }) => string);
  models: ModelsConfig;
  tools?: ToolDefinition<any>[];
  mcpServers?: Record<string, McpServerConfig>;
  hooks?: Hook[];
  subagents?: SubagentDefinition[];
  /** Procedures and house rules the agent loads on demand. See loadSkills(). */
  skills?: SkillDefinition[];
  /** Built-in schedules. Pass `false` to disable scheduling entirely. */
  schedules?: ScheduleDefinition[] | false;
  storage?: import("./storage.ts").AgentStorage;
  /** Model turns per run before the harness stops the loop. Default 24. */
  maxTurns?: number;
  /** How long an approval waits before it expires. Default 15 minutes. */
  approvalTimeoutMs?: number;
  /** Allow adding HTTP MCP servers through the API. Restrict by role with { roles }. */
  runtimeMcp?: boolean | { roles: string[] };
  /** Identity for config schedules. */
  systemUser?: AgentUser;
  /** IANA timezone for dates in prompts and schedules. Default: the server's. */
  timezone?: string;
  logger?: Logger;
}

export type { ModelRef, ThinkingLevel };
