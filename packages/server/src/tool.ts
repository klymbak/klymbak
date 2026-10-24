import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent, TSchema } from "@earendil-works/pi-ai";
import { humanize, type ToolInfo, type UiBlock } from "@klymbak/protocol";
import { localize } from "./i18n.ts";
import type { ApprovalRequest, HookContext, ToolContext, ToolDefinition, ToolOutput } from "./types.ts";

const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_MAX_RESULT_CHARS = 24_000;

/** Declares a tool. The identity function exists for type inference of `args`. */
export function defineTool<P extends TSchema>(definition: ToolDefinition<P>): ToolDefinition<P> {
  if (!TOOL_NAME.test(definition.name)) {
    throw new Error(`Invalid tool name "${definition.name}". Use 1-64 characters of [A-Za-z0-9_-].`);
  }
  return definition;
}

export interface NormalizedOutput {
  content: (TextContent | ImageContent)[];
  ui: UiBlock[];
  data?: unknown;
  isError: boolean;
}

/** Details stored on pi tool results. Only `ui` reaches the browser. */
export interface ToolResultDetails {
  ui?: UiBlock[];
  progress?: string;
  /** Set when the harness refused the call. */
  blocked?: "denied" | "blocked";
}

export function normalizeOutput(output: ToolOutput, maxChars = DEFAULT_MAX_RESULT_CHARS): NormalizedOutput {
  if (typeof output === "string") {
    return { content: [{ type: "text", text: truncate(output, maxChars) }], ui: [], isError: false };
  }
  const ui = output.ui === undefined ? [] : Array.isArray(output.ui) ? output.ui : [output.ui];
  let text = output.text;
  if (text === undefined) {
    text = output.data === undefined ? (ui.length ? "Displayed to the user." : "Done.") : safeJson(output.data);
  }
  const content: (TextContent | ImageContent)[] = [{ type: "text", text: truncate(text, maxChars) }];
  for (const image of output.images ?? []) content.push({ type: "image", data: image.data, mimeType: image.mimeType });
  return { content, ui, data: output.data, isError: output.isError === true };
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[Truncated ${omitted} characters. Narrow the request (filters, limits) to see the rest.]`;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return String(value);
  }
}

export function contentText(content: readonly (TextContent | ImageContent)[] | undefined): string {
  if (!content) return "";
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export interface ToolBinding extends HookContext {
  /** Raw outputs by tool call id, read by postToolUse hooks. */
  rawOutputs: Map<string, NormalizedOutput>;
  /** Called when execute() actually starts (after every approval in the batch). */
  onStart?(toolCallId: string): void;
}

/** Adapts a ToolDefinition to pi's AgentTool, binding the caller's context. */
export function toAgentTool(definition: ToolDefinition<any>, binding: ToolBinding): AgentTool<any, ToolResultDetails> {
  return {
    name: definition.name,
    label: toolLabel(definition, undefined),
    description: definition.description,
    parameters: definition.parameters,
    executionMode: definition.sequential ? "sequential" : undefined,
    async execute(toolCallId, params, signal, onUpdate): Promise<AgentToolResult<ToolResultDetails>> {
      const { rawOutputs, onStart, ...hookContext } = binding;
      onStart?.(toolCallId);
      const ctx: ToolContext = {
        ...hookContext,
        toolCallId,
        signal: signal ?? new AbortController().signal,
        progress: (text) => onUpdate?.({ content: [{ type: "text", text }], details: { progress: text } }),
      };
      const output = normalizeOutput(await definition.execute(params, ctx), definition.maxResultChars);
      rawOutputs.set(toolCallId, output);
      return { content: output.content, details: { ui: output.ui }, isError: output.isError || undefined };
    },
  };
}

/** Resolves a tool's approval policy for one call. Undefined means no approval needed. */
export async function resolveApproval(
  definition: ToolDefinition<any>,
  args: unknown,
  ctx: HookContext,
): Promise<ApprovalRequest | undefined> {
  const policy = definition.approval;
  if (!policy) return undefined;
  const decision = typeof policy === "function" ? await policy(args, ctx) : policy;
  if (!decision) return undefined;
  const fallback: ApprovalRequest = {
    title: toolLabel(definition, ctx.user.locale),
    description: describeArgs(args),
    risk: definition.readOnly ? "low" : "medium",
  };
  return decision === true ? fallback : { ...fallback, ...decision };
}

function describeArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const lines = Object.entries(args as Record<string, unknown>)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${humanize(key)}: ${typeof value === "object" ? safeJson(value) : String(value)}`);
  return lines.length ? lines.join("\n") : undefined;
}

/** The tool card's name for a tool, in the person's language when the tool has one. */
export function toolLabel(definition: ToolDefinition<any>, locale: string | undefined): string {
  return definition.label ? localize(definition.label, locale) : humanize(definition.name);
}

/** A tool for the Tools panel: its label and summary in the person's language. */
export function toolInfo(definition: ToolDefinition<any>, locale?: string): ToolInfo {
  return {
    name: definition.name,
    label: toolLabel(definition, locale),
    description: definition.summary ? localize(definition.summary, locale) : definition.description,
    source: definition.source ?? "local",
    server: definition.server,
    approval: !definition.approval ? "never" : typeof definition.approval === "function" ? "conditional" : "always",
    readOnly: definition.readOnly,
  };
}

export function userCanUse(definition: ToolDefinition<any>, roles: readonly string[]): boolean {
  return !definition.roles?.length || definition.roles.some((role) => roles.includes(role));
}
