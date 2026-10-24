import type { Risk, UiBlock } from "@klymbak/protocol";
import type { AgentUser, Hook, HookContext, ToolDefinition } from "./types.ts";

/** Asks a person before matching tools run, e.g. MCP tools you don't control. */
export function requireApproval(options: {
  tools: string[] | RegExp;
  /** A function also gets the context, whose `user.locale` is the person's language. */
  title?: string | ((tool: ToolDefinition<any>, args: any, ctx: HookContext) => string);
  risk?: Risk;
  reason?: string;
}): Hook {
  return {
    name: "require-approval",
    tools: options.tools,
    preToolUse: ({ tool, args, ctx }) => ({
      decision: "ask",
      reason: options.reason,
      approval: {
        title: typeof options.title === "function" ? options.title(tool, args, ctx) : options.title,
        risk: options.risk,
      },
    }),
  };
}

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const PHONE = /(?<!\w)(\+?\d[\d\s().-]{6,}\d)(?!\w)/g;
const CARD = /\b(?:\d[ -]?){12,15}(\d{4})\b/g;

export function maskText(text: string): string {
  return text
    .replace(CARD, (_m, last4: string) => `•••• ${last4}`)
    .replace(EMAIL, (_m, first: string, domain: string) => `${first}•••${domain}`)
    .replace(PHONE, (match: string) => {
      const digits = match.replace(/\D/g, "");
      return digits.length < 7 ? match : `•••-${digits.slice(-4)}`;
    });
}

function maskDeep(value: unknown): unknown {
  if (typeof value === "string") return maskText(value);
  if (Array.isArray(value)) return value.map(maskDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v)]));
  }
  return value;
}

/**
 * Masks emails, phone numbers and card numbers in tool results, both what the model
 * reads and what the user sees, for users with the given roles (default: everyone).
 */
export function redactPii(options: { roles?: string[]; tools?: string[] | RegExp } = {}): Hook {
  const applies = (user: AgentUser) => !options.roles || options.roles.some((role) => user.roles.includes(role));
  return {
    name: "redact-pii",
    tools: options.tools,
    postToolUse: ({ result, ctx }) => {
      if (!applies(ctx.user)) return;
      return {
        text: maskText(result.text),
        ui: result.ui.map((block) => maskDeep(block) as UiBlock),
      };
    },
  };
}

export interface AuditEntry {
  at: number;
  user: { id: string; name: string };
  sessionId: string;
  agent: string;
  tool: string;
  args: unknown;
  ok: boolean;
  result: string;
  unattended: boolean;
}

/** Records every data-changing tool call (and read-only ones if asked). */
export function auditTrail(
  sink: (entry: AuditEntry, ctx: HookContext) => void | Promise<void>,
  options: { includeReadOnly?: boolean } = {},
): Hook {
  return {
    name: "audit-trail",
    postToolUse: async ({ tool, args, result, ctx }) => {
      if (tool.readOnly && !options.includeReadOnly) return;
      await sink(
        {
          at: Date.now(),
          user: { id: ctx.user.id, name: ctx.user.name },
          sessionId: ctx.sessionId,
          agent: ctx.agent,
          tool: tool.name,
          args,
          ok: !result.isError,
          result: result.text.slice(0, 500),
          unattended: ctx.headless,
        },
        ctx,
      );
    },
  };
}
