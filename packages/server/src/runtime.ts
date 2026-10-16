import { randomUUID } from "node:crypto";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  addUsage,
  applyEvent,
  emptyUsage,
  parseModelRef,
  type AddMcpServerRequest,
  type AgentConfigInfo,
  type AgentEvent,
  type ApprovalDecision,
  type CreateSessionRequest,
  type McpServerInfo,
  type ModelRef,
  type NotificationEvent,
  type RunRequest,
  type RunStatus,
  type SessionDetail,
  type SessionSource,
  type SessionSummary,
  type ThinkingLevel,
  type UpdateSessionRequest,
} from "@klymbak/protocol";
import { ApprovalBroker } from "./approvals.ts";
import { AgentError, notFound } from "./errors.ts";
import { errorMessage, Harness, type HarnessResult } from "./harness.ts";
import { McpManager } from "./mcp.ts";
import { ModelRegistry } from "./models.ts";
import {
  composePrompt,
  delegationSection,
  environmentSection,
  HARNESS_GUIDELINES,
  HEADLESS_SECTION,
  SCHEDULING_SECTION,
  turnContext,
} from "./prompt.ts";
import { Scheduler } from "./scheduler.ts";
import {
  canSeeSession,
  memoryStorage,
  type AgentStorage,
  type SessionRecord,
  type SessionSummaryRecord,
} from "./storage.ts";
import { toolInfo, userCanUse } from "./tool.ts";
import type {
  AgentRuntimeConfig,
  AgentUser,
  Hook,
  HookContext,
  Logger,
  SubagentDefinition,
  ToolDefinition,
} from "./types.ts";

const DEFAULT_TITLE = "New conversation";
const IDLE_EVICT_MS = 30 * 60_000;
const SCHEDULING_TOOLS = new Set(["schedule_task", "cancel_scheduled_task"]);
/** Page context from the client is for orientation, not a document upload. */
const MAX_PAGE_CONTEXT_CHARS = 4_000;

type Listener = (event: AgentEvent) => void;

interface SessionHandle {
  record: SessionRecord;
  harness?: Harness;
  /** Everyone watching this session: the run's own response stream plus attached viewers. */
  listeners: Set<Listener>;
  run?: { id: string; done: Promise<RunOutcome> };
  allowed: Set<string>;
  lastUsed: number;
  /** Current run's event pipeline; the harness emits through it. */
  emit: Listener;
}

export interface RunOutcome extends HarnessResult {
  sessionId: string;
}

export interface ActiveRun {
  id: string;
  sessionId: string;
  done: Promise<RunOutcome>;
  /** Stops delivering events to the listener passed to startRun. The run keeps going. */
  detach(): void;
}

export interface HeadlessRunOptions {
  user: AgentUser;
  prompt: string;
  title?: string;
  scheduleId?: string;
  /** Run as this subagent. */
  agent?: string;
  model?: string;
  audience?: string[];
  onStart?(sessionId: string): void;
}

export type NotifyScope = AgentUser | { userId?: string; roles?: string[] };

const consoleLogger: Logger = {
  info: (message, data) => console.log(`[agent] ${message}`, data ?? ""),
  warn: (message, data) => console.warn(`[agent] ${message}`, data ?? ""),
  error: (message, data) => console.error(`[agent] ${message}`, data ?? ""),
};

/**
 * The agent runtime: owns models, tools, MCP connections, hooks, approvals,
 * subagents, schedules and sessions. HTTP is a thin layer on top (see http.ts),
 * so the runtime can also back a Slack bot, a CLI or tests.
 */
export class AgentRuntime {
  readonly config: AgentRuntimeConfig;
  readonly logger: Logger;
  readonly timezone: string;
  readonly hooks: Hook[];
  readonly subagents: SubagentDefinition[];
  readonly approvals: ApprovalBroker;
  readonly storage: AgentStorage;
  readonly systemUser: AgentUser;
  readonly mcp: McpManager;
  readonly scheduler?: Scheduler;
  models!: ModelRegistry;

  private readonly handles = new Map<string, SessionHandle>();
  private readonly subscribers = new Set<{ user: AgentUser; fn: (event: NotificationEvent) => void }>();
  private starting?: Promise<void>;

  constructor(config: AgentRuntimeConfig) {
    this.config = config;
    this.logger = config.logger ?? consoleLogger;
    this.timezone = config.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    this.hooks = config.hooks ?? [];
    this.subagents = config.subagents ?? [];
    this.approvals = new ApprovalBroker(config.approvalTimeoutMs ?? 15 * 60_000);
    this.storage = config.storage ?? memoryStorage();
    this.systemUser = config.systemUser ?? { id: "system", name: "Scheduler", roles: ["admin"] };
    this.mcp = new McpManager(this.logger, (server) => this.notify({ type: "mcp_update", server }));
    if (config.schedules !== false) this.scheduler = new Scheduler(this, this.storage, config.schedules ?? []);

    for (const tool of config.tools ?? []) {
      if ((config.tools ?? []).filter((t) => t.name === tool.name).length > 1) throw new Error(`Duplicate tool name "${tool.name}".`);
    }
  }

  /** Connects providers, MCP servers and the scheduler. Safe to call more than once. */
  start(): Promise<void> {
    this.starting ??= (async () => {
      this.models = await ModelRegistry.create(this.config.models, this.logger);
      await Promise.all([this.models.refresh(), this.mcp.start(this.config.mcpServers ?? {})]);
      await this.scheduler?.start();
      const models = await this.models.list();
      this.logger.info(`Ready: ${models.length} models, ${this.allTools().length} tools, ${this.subagents.length} subagents`);
    })();
    return this.starting;
  }

  async stop() {
    this.scheduler?.stop();
    for (const handle of this.handles.values()) handle.harness?.abort();
    await this.mcp.close();
  }

  // -------------------------------------------------------------------------
  // Tools and prompts
  // -------------------------------------------------------------------------

  allTools(): ToolDefinition<any>[] {
    return [...(this.config.tools ?? []), ...(this.scheduler?.tools() ?? []), ...this.mcp.tools()];
  }

  toolsFor(user: AgentUser, options: { headless?: boolean } = {}): ToolDefinition<any>[] {
    return this.allTools().filter(
      (tool) => userCanUse(tool, user.roles) && !(options.headless && SCHEDULING_TOOLS.has(tool.name)),
    );
  }

  toolsForSubagent(user: AgentUser, definition: SubagentDefinition, headless = false): ToolDefinition<any>[] {
    const filter = definition.tools;
    return this.toolsFor(user, { headless }).filter((tool) =>
      filter === undefined ? true : Array.isArray(filter) ? filter.includes(tool.name) : filter(tool),
    );
  }

  mainPrompt(user: AgentUser, headless: boolean, extra: string[] = []): string {
    const base = typeof this.config.systemPrompt === "function" ? this.config.systemPrompt({ user }) : this.config.systemPrompt;
    return composePrompt(
      base,
      HARNESS_GUIDELINES,
      environmentSection(user, this.timezone),
      delegationSection(this.subagents),
      this.scheduler && !headless && SCHEDULING_SECTION,
      headless && HEADLESS_SECTION,
      ...extra,
    );
  }

  subagentPrompt(definition: SubagentDefinition, user: AgentUser, headless: boolean, extra: string[] = []): string {
    return composePrompt(
      definition.systemPrompt,
      HARNESS_GUIDELINES,
      environmentSection(user, this.timezone),
      `## Your role\nYou are the "${definition.name}" specialist. Finish with a clear, complete answer: it is all the requesting agent will see.`,
      headless && HEADLESS_SECTION,
      ...extra,
    );
  }

  async configInfo(user: AgentUser): Promise<AgentConfigInfo> {
    await this.start();
    const tools = this.toolsFor(user).map(toolInfo);
    if (this.subagents.length) {
      tools.push({
        name: "delegate_task",
        label: "Delegate to specialist",
        description: "Hands a task to one of the specialist agents.",
        source: "subagent",
        approval: "never",
        readOnly: true,
      });
    }
    return {
      app: this.config.app ?? { name: "Assistant" },
      user: { id: user.id, name: user.name, roles: user.roles },
      models: await this.models.list(),
      defaultModel: await this.models.defaultRef(),
      tools,
      subagents: this.subagents.map((s) => ({
        name: s.name,
        description: s.description,
        tools: this.toolsForSubagent(user, s).map((t) => t.name),
        model: s.model ? parseModelRef(s.model) : undefined,
      })),
      mcpServers: this.mcp.info(),
      features: {
        schedules: Boolean(this.scheduler),
        steering: true,
        runtimeMcp: this.canManageMcp(user),
        attachments: true,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  async listSessions(user: AgentUser): Promise<SessionSummary[]> {
    const records = await this.storage.listSessions({ userId: user.id, roles: user.roles });
    return records.map((record) => this.summary(record));
  }

  async createSession(
    user: AgentUser,
    request: CreateSessionRequest = {},
    options: { source?: SessionSource; scheduleId?: string; audience?: string[]; agent?: string; unread?: boolean } = {},
  ): Promise<SessionDetail> {
    const now = Date.now();
    const record: SessionRecord & { agent?: string } = {
      id: randomUUID().replace(/-/g, "").slice(0, 16),
      userId: user.id,
      audience: options.audience,
      title: request.title?.trim() || DEFAULT_TITLE,
      createdAt: now,
      updatedAt: now,
      source: options.source ?? "chat",
      scheduleId: options.scheduleId,
      model: request.model,
      thinkingLevel: request.thinkingLevel,
      allowedTools: [],
      unread: options.unread,
      messages: [],
      view: [],
      agent: options.agent,
    };
    await this.storage.saveSession(record);
    const handle = this.cache(record);
    this.notify({ type: "session_update", session: this.summary(record) }, this.sessionScope(record));
    return this.detail(handle);
  }

  async getSession(user: AgentUser, id: string): Promise<SessionDetail> {
    return this.detail(await this.handle(user, id));
  }

  async updateSession(user: AgentUser, id: string, patch: UpdateSessionRequest): Promise<SessionSummary> {
    const handle = await this.handle(user, id);
    const { record } = handle;
    if (patch.title !== undefined) record.title = patch.title.trim().slice(0, 120) || record.title;
    if (patch.model !== undefined) record.model = patch.model;
    if (patch.thinkingLevel !== undefined) record.thinkingLevel = patch.thinkingLevel;
    if (patch.unread !== undefined) record.unread = patch.unread || undefined;
    await this.storage.saveSession(record);
    const summary = this.summary(record);
    this.notify({ type: "session_update", session: summary }, this.sessionScope(record));
    return summary;
  }

  async deleteSession(user: AgentUser, id: string): Promise<void> {
    const handle = await this.handle(user, id);
    if (handle.record.userId !== user.id && !user.roles.includes("admin")) {
      throw new AgentError(403, "Only the owner can delete this conversation.", "forbidden");
    }
    handle.harness?.abort();
    await handle.run?.done.catch(() => undefined);
    handle.harness?.dispose();
    this.handles.delete(id);
    await this.storage.deleteSession(id);
    this.notify({ type: "session_delete", sessionId: id }, this.sessionScope(handle.record));
  }

  /**
   * Starts a run. `listener` receives every event of this run from `run_start`
   * to `run_end`. Validation problems throw before anything starts.
   */
  async startRun(user: AgentUser, sessionId: string, request: RunRequest, listener?: Listener): Promise<ActiveRun> {
    const handle = await this.handle(user, sessionId);
    if (handle.run) throw new AgentError(409, "The agent is still working on this conversation. Wait for it or stop it first.", "busy");
    const text = request.prompt?.trim() ?? "";
    if (!text && !request.images?.length) throw new AgentError(400, "Type a message first.", "empty_prompt");

    const model = await this.models.resolve(request.model ?? handle.record.model);
    const thinking = this.models.clampThinking(model, request.thinkingLevel ?? handle.record.thinkingLevel);
    if (listener) handle.listeners.add(listener);
    const id = this.beginRun(handle, user, {
      text,
      images: request.images,
      pageContext: pageContext(request.context),
      model,
      thinking,
      headless: false,
      origin: "user",
    });
    return {
      id,
      sessionId,
      done: handle.run!.done,
      detach: () => {
        if (listener) handle.listeners.delete(listener);
      },
    };
  }

  /** Streams a session: a snapshot first, then live events. Returns an unsubscribe function. */
  async attach(user: AgentUser, sessionId: string, listener: Listener): Promise<() => void> {
    const handle = await this.handle(user, sessionId);
    listener({ type: "snapshot", session: this.detail(handle) });
    handle.listeners.add(listener);
    return () => handle.listeners.delete(listener);
  }

  async abort(user: AgentUser, sessionId: string): Promise<void> {
    const handle = await this.handle(user, sessionId);
    handle.harness?.abort();
  }

  async steer(user: AgentUser, sessionId: string, text: string): Promise<void> {
    const handle = await this.handle(user, sessionId);
    if (!handle.run || !handle.harness) throw new AgentError(409, "The agent isn't running, so send this as a normal message.", "idle");
    if (!text.trim()) throw new AgentError(400, "Type a message first.", "empty_prompt");
    handle.harness.steer(text.trim());
  }

  async decide(user: AgentUser, sessionId: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
    await this.handle(user, sessionId);
    if (!this.approvals.decide(sessionId, approvalId, decision, user.name)) {
      throw new AgentError(404, "This approval is no longer waiting for a decision.", "approval_gone");
    }
  }

  /** Runs a prompt with nobody watching (schedules, webhooks). Approvals are refused. */
  async runHeadless(options: HeadlessRunOptions): Promise<RunOutcome> {
    await this.start();
    const agent = options.agent ? this.subagents.find((s) => s.name === options.agent) : undefined;
    if (options.agent && !agent) throw new AgentError(400, `Unknown agent "${options.agent}".`);
    const modelRef = options.model ?? agent?.model;
    const model = await this.models.resolve(modelRef ? parseModelRef(modelRef) : undefined);
    const session = await this.createSession(
      options.user,
      { title: options.title, model: { provider: model.provider, id: model.id } },
      {
        source: options.scheduleId ? "schedule" : "api",
        scheduleId: options.scheduleId,
        audience: options.audience,
        agent: agent?.name,
        unread: true,
      },
    );
    const handle = this.handles.get(session.id)!;
    options.onStart?.(session.id);
    this.beginRun(handle, options.user, {
      text: options.prompt,
      model,
      thinking: this.models.clampThinking(model, agent?.thinkingLevel ?? "off"),
      headless: true,
      origin: options.scheduleId ? "schedule" : "user",
    });
    return handle.run!.done;
  }

  // -------------------------------------------------------------------------
  // MCP at runtime
  // -------------------------------------------------------------------------

  canManageMcp(user: AgentUser): boolean {
    const setting = this.config.runtimeMcp;
    if (!setting) return false;
    if (setting === true) return user.roles.includes("admin");
    return setting.roles.some((role) => user.roles.includes(role));
  }

  async addMcpServer(user: AgentUser, request: AddMcpServerRequest): Promise<McpServerInfo> {
    if (!this.canManageMcp(user)) throw new AgentError(403, "You can't add integrations.", "forbidden");
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      throw new AgentError(400, "Enter a full URL, e.g. https://mcp.example.com/mcp.");
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new AgentError(400, "Only HTTP(S) MCP servers can be added at runtime.");
    if (this.mcp.has(request.name) && !this.mcp.isRuntime(request.name)) {
      throw new AgentError(409, `"${request.name}" is already configured on the server.`);
    }
    return this.mcp.connect(request.name, { url: url.toString(), headers: request.headers }, true);
  }

  async removeMcpServer(user: AgentUser, name: string): Promise<void> {
    if (!this.canManageMcp(user)) throw new AgentError(403, "You can't remove integrations.", "forbidden");
    if (!this.mcp.isRuntime(name)) throw new AgentError(400, "Only integrations added at runtime can be removed here.");
    await this.mcp.remove(name);
    this.notify({ type: "mcp_update", server: { name, transport: "http", target: "", status: "disabled", tools: [], runtime: true } });
  }

  // -------------------------------------------------------------------------
  // Notifications
  // -------------------------------------------------------------------------

  subscribe(user: AgentUser, fn: (event: NotificationEvent) => void): () => void {
    const entry = { user, fn };
    this.subscribers.add(entry);
    return () => this.subscribers.delete(entry);
  }

  notify(event: NotificationEvent, scope?: NotifyScope) {
    for (const { user, fn } of this.subscribers) {
      if (!inScope(user, scope)) continue;
      try {
        fn(event);
      } catch (error) {
        this.logger.warn("Notification listener failed", errorMessage(error));
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private beginRun(
    handle: SessionHandle,
    user: AgentUser,
    options: {
      text: string;
      images?: { mimeType: string; data: string }[];
      /** What the person has open in the host app (RunRequest.context). */
      pageContext?: string;
      model: Model<Api>;
      thinking: ThinkingLevel;
      headless: boolean;
      origin: "user" | "schedule";
    },
  ): string {
    const runId = randomUUID();
    const { record } = handle;
    if (record.title === DEFAULT_TITLE) record.title = titleFrom(options.text);
    record.model = { provider: options.model.provider, id: options.model.id };
    record.thinkingLevel = options.thinking;
    const emit = this.emitter(handle, user, options.headless);
    const done = this.executeRun(handle, user, runId, emit, options);
    handle.run = { id: runId, done };
    this.notify({ type: "session_update", session: this.summary(record) }, this.sessionScope(record));
    return runId;
  }

  private async executeRun(
    handle: SessionHandle,
    user: AgentUser,
    runId: string,
    emit: Listener,
    options: Parameters<AgentRuntime["beginRun"]>[2],
  ): Promise<RunOutcome> {
    const { record } = handle;
    const ctx = this.hookContext(handle, user, options.headless);
    emit({ type: "run_start", runId, sessionId: record.id, model: record.model as ModelRef, at: Date.now() });
    // Let synchronous callers (HTTP handlers) finish wiring before events flow.
    await Promise.resolve();

    let result: HarnessResult = { status: "completed", text: "", usage: emptyUsage() };
    let prompt = options.text;
    try {
      const contexts: string[] = options.pageContext ? [`Open in the app right now: ${options.pageContext}`] : [];
      let blocked: string | undefined;
      for (const hook of this.hooks) {
        if (!hook.userPromptSubmit) continue;
        const outcome = await hook.userPromptSubmit({ prompt, ctx });
        if (outcome?.block) {
          blocked = outcome.block;
          break;
        }
        if (outcome?.prompt) prompt = outcome.prompt;
        if (outcome?.context) contexts.push(outcome.context);
      }

      if (blocked) {
        emit({
          type: "message_start",
          message: { id: randomUUID(), role: "user", parts: [{ type: "text", text: options.text }], createdAt: Date.now(), status: "done", origin: options.origin },
        });
        emit({
          type: "message_end",
          message: { id: randomUUID(), role: "notice", level: "warning", parts: [{ type: "text", text: blocked }], createdAt: Date.now(), status: "done" },
        });
      } else {
        const harness = await this.ensureHarness(handle, user, options.model, options.thinking, options.headless);
        result = await harness.run({
          text: prompt,
          images: options.images,
          context: turnContext(this.timezone, contexts.join("\n")),
          origin: options.origin,
        });
        record.messages = harness.agent.state.messages;
      }
    } catch (error) {
      result = { status: "error", text: "", error: errorMessage(error), usage: result.usage };
      this.logger.error(`Run ${runId} failed`, result.error);
    }

    if (result.status === "error" && result.error) {
      emit({
        type: "message_end",
        message: { id: randomUUID(), role: "notice", level: "error", parts: [{ type: "text", text: result.error }], createdAt: Date.now(), status: "done" },
      });
    }

    record.usage = addUsage(record.usage ?? emptyUsage(), result.usage);
    record.updatedAt = Date.now();
    record.preview = (result.text || prompt).replace(/\s+/g, " ").slice(0, 160);
    emit({ type: "run_end", runId, status: result.status, error: result.error, usage: result.usage });
    handle.run = undefined;
    handle.lastUsed = Date.now();

    try {
      await this.storage.saveSession(record);
    } catch (error) {
      this.logger.error(`Saving session ${record.id} failed`, errorMessage(error));
    }
    for (const hook of this.hooks) {
      try {
        await hook.runEnd?.({ status: result.status, usage: result.usage, error: result.error, ctx });
      } catch (error) {
        this.logger.error(`runEnd hook "${hook.name}" failed`, errorMessage(error));
      }
    }
    this.notify({ type: "session_update", session: this.summary(record) }, this.sessionScope(record));
    this.evictIdle();
    return { ...result, sessionId: record.id };
  }

  private async ensureHarness(
    handle: SessionHandle,
    user: AgentUser,
    model: Model<Api>,
    thinking: ThinkingLevel,
    headless: boolean,
  ): Promise<Harness> {
    const record = handle.record as SessionRecord & { agent?: string };
    const agent = record.agent ? this.subagents.find((s) => s.name === record.agent) : undefined;
    const tools = agent ? this.toolsForSubagent(user, agent, headless) : this.toolsFor(user, { headless });

    if (handle.harness) {
      handle.harness.setUser(user);
      handle.harness.setModel(model, thinking);
      handle.harness.setTools(tools);
      return handle.harness;
    }

    let systemPrompt = "";
    if (record.messages.length === 0) {
      const extra: string[] = [];
      const ctx = this.hookContext(handle, user, headless);
      for (const hook of this.hooks) {
        try {
          const result = await hook.sessionStart?.({ ctx });
          if (result?.context) extra.push(result.context);
        } catch (error) {
          this.logger.error(`sessionStart hook "${hook.name}" failed`, errorMessage(error));
        }
      }
      systemPrompt = agent ? this.subagentPrompt(agent, user, headless, extra) : this.mainPrompt(user, headless, extra);
    }

    handle.harness = new Harness({
      runtime: this,
      user,
      sessionId: record.id,
      agentName: agent?.name ?? "main",
      source: record.source,
      headless,
      emit: (event) => handle.emit(event),
      tools,
      subagents: agent ? [] : this.subagents,
      systemPrompt,
      model,
      thinkingLevel: thinking,
      messages: record.messages.length ? record.messages : undefined,
      maxTurns: this.config.maxTurns ?? 24,
      allowedTools: handle.allowed,
      onAllowedToolsChange: () => {
        record.allowedTools = [...handle.allowed];
      },
    });
    return handle.harness;
  }

  /** Applies events to the stored view, runs onEvent hooks, then fans out to listeners. */
  private emitter(handle: SessionHandle, user: AgentUser, headless: boolean): Listener {
    const ctx = this.hookContext(handle, user, headless);
    const observers = this.hooks.filter((hook) => hook.onEvent);
    const emit: Listener = (event) => {
      applyEvent(handle.record.view, event);
      for (const hook of observers) {
        try {
          hook.onEvent!(event, ctx);
        } catch (error) {
          this.logger.warn(`onEvent hook "${hook.name}" failed`, errorMessage(error));
        }
      }
      this.fanOut(handle, event);
    };
    handle.emit = emit;
    return emit;
  }

  private fanOut(handle: SessionHandle, event: AgentEvent) {
    for (const listener of [...handle.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn("Session listener failed", errorMessage(error));
      }
    }
  }

  private hookContext(handle: SessionHandle, user: AgentUser, headless: boolean): HookContext {
    return { user, sessionId: handle.record.id, agent: "main", headless, source: handle.record.source, runtime: this };
  }

  private async handle(user: AgentUser, id: string): Promise<SessionHandle> {
    await this.start();
    let handle = this.handles.get(id);
    if (!handle) {
      const record = await this.storage.getSession(id);
      if (!record) throw notFound("Conversation");
      handle = this.cache(record);
    }
    if (!canSeeSession(handle.record, { userId: user.id, roles: user.roles })) throw notFound("Conversation");
    handle.lastUsed = Date.now();
    return handle;
  }

  private cache(record: SessionRecord): SessionHandle {
    const handle: SessionHandle = {
      record,
      listeners: new Set(),
      allowed: new Set(record.allowedTools),
      lastUsed: Date.now(),
      emit: (event) => {
        applyEvent(record.view, event);
        this.fanOut(handle, event);
      },
    };
    this.handles.set(record.id, handle);
    return handle;
  }

  private evictIdle() {
    const cutoff = Date.now() - IDLE_EVICT_MS;
    for (const [id, handle] of this.handles) {
      if (!handle.run && handle.listeners.size === 0 && handle.lastUsed < cutoff) {
        handle.harness?.dispose();
        this.handles.delete(id);
      }
    }
  }

  private summary(record: SessionSummaryRecord): SessionSummary {
    return {
      id: record.id,
      title: record.title,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      source: record.source,
      scheduleId: record.scheduleId,
      model: record.model,
      running: Boolean(this.handles.get(record.id)?.run),
      unread: record.unread,
      preview: record.preview,
      usage: record.usage,
    };
  }

  private detail(handle: SessionHandle): SessionDetail {
    const { record } = handle;
    return {
      ...this.summary(record),
      messages: record.view,
      thinkingLevel: record.thinkingLevel,
      activeRunId: handle.run?.id,
      allowedTools: [...handle.allowed],
    };
  }

  private sessionScope(record: SessionRecord): NotifyScope {
    return { userId: record.userId, roles: record.audience };
  }
}

export function createAgentRuntime(config: AgentRuntimeConfig): AgentRuntime {
  return new AgentRuntime(config);
}

function inScope(user: AgentUser, scope: NotifyScope | undefined): boolean {
  if (!scope) return true;
  if ("id" in scope && typeof scope.id === "string" && Array.isArray((scope as AgentUser).roles) && "name" in scope) {
    return scope.id === user.id;
  }
  const { userId, roles } = scope as { userId?: string; roles?: string[] };
  return (userId !== undefined && userId === user.id) || (roles ?? []).some((role) => user.roles.includes(role));
}

function pageContext(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.length > MAX_PAGE_CONTEXT_CHARS ? `${text.slice(0, MAX_PAGE_CONTEXT_CHARS)}…` : text;
}

function titleFrom(prompt: string): string {
  const line = prompt.split("\n")[0]!.trim();
  if (line.length <= 60) return line || DEFAULT_TITLE;
  const cut = line.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}…`;
}

export type { RunStatus };
