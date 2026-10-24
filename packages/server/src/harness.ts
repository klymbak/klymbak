import { randomUUID } from "node:crypto";
import { Agent, type AgentMessage, type AgentToolResult } from "@earendil-works/pi-agent-core";
import { StringEnum, Type, type Api, type ImageContent, type Model, type TextContent } from "@earendil-works/pi-ai";
import {
  addUsage,
  emptyUsage,
  matchLocale,
  type AgentEvent,
  type ChatMessage,
  type RunStatus,
  type SessionSource,
  type ThinkingLevel,
  type UsageInfo,
} from "@klymbak/protocol";
import { createContextManager } from "./context.ts";
import { errorText } from "./errors.ts";
import { attachEventMapper, toUsageInfo, type Refusal, type ToolMeta } from "./events.ts";
import { t } from "./messages.ts";
import { turnContext } from "./prompt.ts";
import type { AgentRuntime } from "./runtime.ts";
import {
  contentText,
  defineTool,
  resolveApproval,
  toAgentTool,
  toolLabel,
  type NormalizedOutput,
  type ToolResultDetails,
} from "./tool.ts";
import type {
  AgentUser,
  ApprovalRequest,
  Hook,
  HookContext,
  SubagentDefinition,
  ToolDefinition,
  ToolResultForHooks,
} from "./types.ts";

export interface HarnessOptions {
  runtime: AgentRuntime;
  user: AgentUser;
  sessionId: string;
  /** "main" or a subagent name. */
  agentName: string;
  source: SessionSource;
  headless: boolean;
  emit(event: AgentEvent): void;
  tools: ToolDefinition<any>[];
  /** Specialists this agent may delegate to. Subagents get none, so nesting stays one level deep. */
  subagents: SubagentDefinition[];
  systemPrompt: string;
  model: Model<Api>;
  thinkingLevel: ThinkingLevel;
  /** Existing transcript when resuming a session. */
  messages?: AgentMessage[];
  maxTurns: number;
  /** Tools the user chose to always allow in this session. Shared with subagents. */
  allowedTools: Set<string>;
  onAllowedToolsChange?(): void;
  /** Called with the usage of every model response, including subagents'. */
  onUsage?(usage: UsageInfo): void;
}

export interface HarnessInput {
  text: string;
  images?: { mimeType: string; data: string }[];
  /** Model-only context appended to the message (must start with <system-context>). */
  context?: string;
  origin?: ChatMessage["origin"];
}

export interface HarnessResult {
  status: RunStatus;
  /** Final assistant text. */
  text: string;
  error?: string;
  usage: UsageInfo;
}

const MAX_STOP_HOOK_CONTINUES = 2;

/**
 * One pi Agent plus everything the harness layers on top: tool binding, hooks,
 * human approvals, delegation to subagents, a turn limit and event translation.
 */
export class Harness {
  readonly agent: Agent;
  private readonly options: HarnessOptions;
  private readonly hooks: Hook[];
  private toolIndex = new Map<string, ToolDefinition<any>>();
  private readonly rawOutputs = new Map<string, NormalizedOutput>();
  private readonly blocked = new Map<string, Refusal>();
  private readonly startedAt = new Map<string, number>();
  private readonly hookFollowUps = new Set<string>();
  private readonly unsubscribe: () => void;
  private user: AgentUser;
  private turn = 0;
  private stopContinues = 0;
  private pendingOrigin: ChatMessage["origin"] | undefined;
  private runUsage: UsageInfo = emptyUsage();

  constructor(options: HarnessOptions) {
    this.options = options;
    this.user = options.user;
    this.hooks = options.runtime.hooks;

    this.agent = new Agent({
      initialState: {
        systemPrompt: options.systemPrompt,
        model: options.model,
        thinkingLevel: options.thinkingLevel,
        tools: this.buildTools(options.tools),
        messages: options.messages,
      },
      streamFn: options.runtime.models.streamFn,
      sessionId: options.sessionId,
      toolExecution: "parallel",
      transformContext: createContextManager(() => this.agent.state.model),
      beforeToolCall: (ctx, signal) => this.beforeToolCall(ctx.toolCall.id, ctx.toolCall.name, ctx.args, signal),
      afterToolCall: (ctx) => this.afterToolCall(ctx.toolCall.id, ctx.toolCall.name, ctx.args, ctx.result, ctx.isError),
      finishTurn: (turn) => this.finishTurn(turn.message),
    });

    this.unsubscribe = attachEventMapper(this.agent, {
      emit: options.emit,
      toolMeta: (name) => this.toolMeta(name),
      blocked: this.blocked,
      startedAt: this.startedAt,
      userOrigin: (message) => {
        if (this.pendingOrigin) {
          const origin = this.pendingOrigin;
          this.pendingOrigin = undefined;
          return origin;
        }
        const text = typeof message.content === "string" ? message.content : contentText(message.content as TextContent[]);
        return this.hookFollowUps.has(text) ? "hook" : "steer";
      },
      onAssistantEnd: (message) => {
        const usage = toUsageInfo(message.usage);
        if (!usage) return;
        addUsage(this.runUsage, usage);
        options.onUsage?.(usage);
      },
    });
  }

  get hookContext(): HookContext {
    const { runtime, sessionId, agentName, headless, source } = this.options;
    return { user: this.user, sessionId, agent: agentName, headless, source, runtime };
  }

  setUser(user: AgentUser) {
    this.user = user;
  }

  /** Replaces the tool loadout. pi announces additions/removals to the model on the next request. */
  setTools(tools: ToolDefinition<any>[]) {
    this.agent.state.tools = this.buildTools(tools);
  }

  private buildTools(tools: ToolDefinition<any>[]) {
    const all = [...tools];
    if (this.options.subagents.length) all.push(this.createDelegateTool());
    this.toolIndex = new Map(all.map((tool) => [tool.name, tool]));
    const binding = {
      ...this.hookContext,
      rawOutputs: this.rawOutputs,
      // pi preflights every call in a batch before executing any, so "running" and the
      // duration start here, not when a call's own approval came through.
      onStart: (toolCallId: string) => {
        const now = Date.now();
        this.startedAt.set(toolCallId, now);
        this.emitTool(toolCallId, { status: "running", startedAt: now });
      },
    };
    return all.map((tool) => toAgentTool(tool, binding));
  }

  setModel(model: Model<Api>, thinkingLevel: ThinkingLevel) {
    this.agent.state.model = model;
    this.agent.state.thinkingLevel = thinkingLevel;
  }

  async run(input: HarnessInput): Promise<HarnessResult> {
    this.turn = 0;
    this.stopContinues = 0;
    this.runUsage = emptyUsage();
    this.pendingOrigin = input.origin ?? "user";

    const content: (TextContent | ImageContent)[] = [{ type: "text", text: input.text }];
    for (const image of input.images ?? []) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
    if (input.context) content.push({ type: "text", text: input.context });

    const before = this.agent.state.messages.length;
    try {
      await this.agent.prompt({ role: "user", content, timestamp: Date.now() });
    } catch (error) {
      return { status: "error", text: "", error: errorText(error, this.user.locale), usage: this.runUsage };
    }

    const added = this.agent.state.messages.slice(before);
    const last = [...added].reverse().find((m) => m.role === "assistant");
    if (!last || last.role !== "assistant") {
      return { status: "error", text: "", error: this.agent.state.errorMessage ?? t(this.user.locale, "notice.noResponse"), usage: this.runUsage };
    }
    const status: RunStatus = last.stopReason === "aborted" ? "aborted" : last.stopReason === "error" ? "error" : "completed";
    const text = last.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    return { status, text, error: last.errorMessage, usage: this.runUsage };
  }

  /** Queues a message the agent reads after its current step, without stopping the run. */
  steer(text: string) {
    this.agent.steer({ role: "user", content: text, timestamp: Date.now() });
  }

  abort() {
    this.agent.abort();
  }

  dispose() {
    this.unsubscribe();
  }

  // -------------------------------------------------------------------------

  private toolMeta(name: string): ToolMeta | undefined {
    const tool = this.toolIndex.get(name);
    if (!tool) return undefined;
    return { label: toolLabel(tool, this.user.locale), source: tool.source ?? "local", server: tool.server };
  }

  private matchingHooks(toolName: string, key: keyof Hook): Hook[] {
    return this.hooks.filter((hook) => {
      if (!hook[key]) return false;
      if (!hook.tools) return true;
      return Array.isArray(hook.tools) ? hook.tools.includes(toolName) : hook.tools.test(toolName);
    });
  }

  private emitTool(toolCallId: string, patch: Extract<AgentEvent, { type: "tool_update" }>["patch"]) {
    this.options.emit({ type: "tool_update", toolCallId, patch });
  }

  notice(level: "info" | "warning" | "error", text: string) {
    this.options.emit({
      type: "message_end",
      message: { id: randomUUID(), role: "notice", level, parts: [{ type: "text", text }], createdAt: Date.now(), status: "done" },
    });
  }

  /** Refuses a call: `reason` tells the model why, `shown` the person, in their language. */
  private refuse(toolCallId: string, status: Refusal["status"], reason: string, shown: string) {
    this.blocked.set(toolCallId, { status, text: shown });
    return { block: true, reason };
  }

  private async beforeToolCall(toolCallId: string, name: string, args: unknown, signal?: AbortSignal) {
    const tool = this.toolIndex.get(name);
    if (!tool) return undefined;
    const ctx = this.hookContext;
    const { runtime } = this.options;

    if (tool.roles?.length && !tool.roles.some((role) => this.user.roles.includes(role))) {
      // "editor or admin" in the sentence's language, which is English when the person's has no messages.
      const roles = new Intl.ListFormat(matchLocale(this.user.locale, t.locales) ?? "en", { type: "disjunction" }).format(tool.roles);
      return this.refuse(
        toolCallId,
        "blocked",
        `Permission denied: ${name} requires the ${tool.roles.join(" or ")} role.`,
        t(this.user.locale, "refused.role", { roles }),
      );
    }

    // Policy hooks: any deny wins, then ask, then allow.
    let decision: "allow" | "ask" | undefined;
    let askReason: string | undefined;
    let approvalOverride: Partial<ApprovalRequest> = {};
    for (const hook of this.matchingHooks(name, "preToolUse")) {
      let result;
      try {
        result = await hook.preToolUse!({ tool, args, toolCallId, ctx });
      } catch (error) {
        runtime.logger.error(`preToolUse hook "${hook.name}" failed`, errorMessage(error));
        return this.refuse(
          toolCallId,
          "blocked",
          `The ${hook.name} policy check failed, so the action was not run.`,
          t(this.user.locale, "refused.hookFailed", { hook: hook.name }),
        );
      }
      if (!result?.decision) continue;
      if (result.decision === "deny") {
        return this.refuse(
          toolCallId,
          "blocked",
          `Blocked by policy (${hook.name}): ${result.reason ?? "not allowed"}`,
          result.reason
            ? t(this.user.locale, "refused.policy", { hook: hook.name, reason: result.reason })
            : t(this.user.locale, "refused.policyNoReason", { hook: hook.name }),
        );
      }
      if (result.decision === "ask") {
        decision = "ask";
        askReason = result.reason ?? askReason;
        approvalOverride = { ...approvalOverride, ...result.approval };
      } else if (decision !== "ask") {
        decision = "allow";
      }
    }

    let request: ApprovalRequest | undefined;
    if (decision === "ask") {
      const base = (await resolveApproval({ ...tool, approval: true }, args, ctx))!;
      request = { ...base, ...approvalOverride, description: approvalOverride.description ?? askReason ?? base.description };
    } else if (decision !== "allow") {
      request = await resolveApproval(tool, args, ctx);
      if (request && this.options.allowedTools.has(name)) request = undefined;
    }

    if (!request) return undefined;

    if (ctx.headless) {
      return this.refuse(
        toolCallId,
        "denied",
        "This action needs a person's approval, and nobody is available in an unattended run. Don't retry; recommend the action in your report instead.",
        t(this.user.locale, "refused.headless"),
      );
    }

    const approval = runtime.approvals.create(this.options.sessionId, toolCallId);
    const view = {
      id: approval.id,
      title: request.title,
      description: request.description,
      risk: request.risk,
      status: "pending" as const,
      rememberable: decision !== "ask",
    };
    this.emitTool(toolCallId, { status: "awaiting_approval", approval: view });
    runtime.notify({ type: "approval_pending", sessionId: this.options.sessionId, approvalId: approval.id, title: request.title }, ctx.user);

    const outcome = await approval.wait(signal);
    if (!outcome.approved) {
      this.emitTool(toolCallId, {
        approval: {
          ...view,
          status: outcome.expired ? "expired" : "denied",
          decidedBy: outcome.decidedBy,
          reason: outcome.reason,
        },
      });
      const locale = this.user.locale;
      if (outcome.aborted) {
        return this.refuse(toolCallId, "denied", "The run was stopped before anyone approved this action.", t(locale, "refused.aborted"));
      }
      if (outcome.expired) {
        return this.refuse(
          toolCallId,
          "denied",
          "Nobody approved this action in time. Don't retry unless the user asks.",
          t(locale, "refused.expired"),
        );
      }
      return this.refuse(
        toolCallId,
        "denied",
        `The user denied this action${outcome.reason ? `: "${outcome.reason}"` : ""}. Don't retry it unless they ask.`,
        outcome.reason ? t(locale, "refused.deniedReason", { reason: outcome.reason }) : t(locale, "refused.denied"),
      );
    }

    if (outcome.remember && view.rememberable) {
      this.options.allowedTools.add(name);
      this.options.onAllowedToolsChange?.();
    }
    this.emitTool(toolCallId, {
      status: "pending",
      approval: { ...view, status: "approved", decidedBy: outcome.decidedBy, reason: outcome.reason },
    });
    return undefined;
  }

  private async afterToolCall(
    toolCallId: string,
    name: string,
    args: unknown,
    result: AgentToolResult<ToolResultDetails>,
    isError: boolean,
  ) {
    const raw = this.rawOutputs.get(toolCallId);
    this.rawOutputs.delete(toolCallId);
    const tool = this.toolIndex.get(name);
    const hooks = tool ? this.matchingHooks(name, "postToolUse") : [];
    if (!tool || hooks.length === 0) return undefined;

    const original: ToolResultForHooks = {
      text: contentText(result.content),
      ui: result.details?.ui ?? [],
      isError,
      data: raw?.data,
    };
    let current = original;
    for (const hook of hooks) {
      try {
        const change = await hook.postToolUse!({ tool, args, toolCallId, result: current, ctx: this.hookContext });
        if (change) current = { ...current, ...change };
      } catch (error) {
        this.options.runtime.logger.error(`postToolUse hook "${hook.name}" failed`, errorMessage(error));
      }
    }
    if (current === original) return undefined;
    const images = result.content.filter((block): block is ImageContent => block.type === "image");
    return {
      content: [{ type: "text" as const, text: current.text }, ...images],
      details: { ...result.details, ui: current.ui },
      isError: current.isError,
    };
  }

  private async finishTurn(message: AgentMessage) {
    this.turn++;
    if (message.role !== "assistant" || message.stopReason === "error" || message.stopReason === "aborted") return undefined;
    const calledTools = message.content.some((block) => block.type === "toolCall");

    if (calledTools && this.turn >= this.options.maxTurns) {
      this.notice("warning", t(this.user.locale, "notice.maxTurns", { count: this.options.maxTurns }));
      return { action: "end" as const };
    }
    if (calledTools || this.stopContinues >= MAX_STOP_HOOK_CONTINUES) return undefined;

    const text = message.content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("");
    for (const hook of this.hooks) {
      if (!hook.stop) continue;
      try {
        const result = await hook.stop({ text, turn: this.turn, ctx: this.hookContext });
        if (result?.continue) {
          this.stopContinues++;
          this.hookFollowUps.add(result.continue);
          this.agent.followUp({ role: "user", content: result.continue, timestamp: Date.now() });
          break;
        }
      } catch (error) {
        this.options.runtime.logger.error(`stop hook "${hook.name}" failed`, errorMessage(error));
      }
    }
    return undefined;
  }

  private createDelegateTool(): ToolDefinition<any> {
    const { subagents, runtime } = this.options;
    const roster = subagents.map((s) => `- ${s.name}: ${s.description}`).join("\n");
    return defineTool({
      name: "delegate_task",
      label: (locale) => t(locale, "tool.delegate.label"),
      summary: (locale) => t(locale, "tool.delegate.summary"),
      source: "subagent",
      readOnly: true,
      description: `Hand a focused, self-contained task to a specialist agent and receive its final answer. The specialist cannot see this conversation, so include every ID, date range and detail it needs. Independent tasks can be delegated in parallel.\n\nSpecialists:\n${roster}`,
      parameters: Type.Object({
        agent: StringEnum(
          subagents.map((s) => s.name),
          { description: "Which specialist to use" },
        ),
        task: Type.String({ description: "Complete instructions for the specialist" }),
      }),
      execute: async ({ agent, task }, ctx) => {
        const definition = subagents.find((s) => s.name === agent);
        if (!definition) throw new Error(`Unknown specialist "${agent}".`);
        const emitChild = (event: AgentEvent) => this.options.emit({ type: "subagent_event", toolCallId: ctx.toolCallId, event });
        this.emitTool(ctx.toolCallId, { subagent: { agent, task, status: "running", messages: [] } });

        const model = definition.model ? await runtime.models.resolve(parseRef(definition.model)) : this.agent.state.model;
        const child = new Harness({
          ...this.options,
          user: this.user,
          agentName: definition.name,
          emit: emitChild,
          tools: runtime.toolsForSubagent(this.user, definition),
          subagents: [],
          systemPrompt: runtime.subagentPrompt(definition, this.user, ctx.headless),
          model,
          thinkingLevel: runtime.models.clampThinking(model, definition.thinkingLevel ?? "off"),
          messages: undefined,
          maxTurns: definition.maxTurns ?? 12,
          onUsage: (usage) => {
            addUsage(this.runUsage, usage);
            this.options.onUsage?.(usage);
          },
        });

        const runId = randomUUID();
        const onAbort = () => child.abort();
        ctx.signal.addEventListener("abort", onAbort, { once: true });
        emitChild({ type: "run_start", runId, sessionId: ctx.sessionId, model: { provider: model.provider, id: model.id }, at: Date.now() });
        try {
          const result = await child.run({ text: task, context: turnContext(runtime.timezone) });
          emitChild({ type: "run_end", runId, status: result.status, error: result.error, usage: result.usage });
          if (result.status !== "completed") {
            throw new Error(result.error ?? `The ${agent} specialist stopped before finishing (${result.status}).`);
          }
          return { text: result.text || `The ${agent} specialist finished without a written answer.` };
        } finally {
          ctx.signal.removeEventListener("abort", onAbort);
          child.dispose();
        }
      },
    });
  }
}

function parseRef(value: string) {
  const index = value.indexOf("/");
  return { provider: value.slice(0, index), id: value.slice(index + 1) };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
