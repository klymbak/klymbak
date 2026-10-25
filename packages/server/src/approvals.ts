import { randomUUID } from "node:crypto";
import { validateToolArguments, type ToolCall } from "@earendil-works/pi-ai";
import type { ApprovalDecision, ApprovalField } from "@klymbak/protocol";
import { agentError } from "./errors.ts";
import type { ToolDefinition } from "./types.ts";

export interface ApprovalOutcome extends ApprovalDecision {
  expired?: boolean;
  aborted?: boolean;
  decidedBy?: string;
}

interface PendingApproval {
  id: string;
  sessionId: string;
  toolCallId: string;
  check?: (decision: ApprovalDecision) => void;
  resolve(outcome: ApprovalOutcome): void;
}

/**
 * Holds tool calls that wait for a person. The agent loop awaits `wait()`;
 * the HTTP layer resolves it through `decide()`.
 */
export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    this.timeoutMs = timeoutMs;
  }

  /** `check` may throw to refuse a decision, such as an edit the tool can't take; the approval then keeps waiting. */
  create(sessionId: string, toolCallId: string, check?: (decision: ApprovalDecision) => void) {
    const id = randomUUID();
    let settle!: (outcome: ApprovalOutcome) => void;
    const promise = new Promise<ApprovalOutcome>((resolve) => (settle = resolve));
    const entry: PendingApproval = { id, sessionId, toolCallId, check, resolve: settle };
    this.pending.set(id, entry);

    const wait = (signal?: AbortSignal): Promise<ApprovalOutcome> => {
      const timer = setTimeout(() => this.finish(id, { approved: false, expired: true }), this.timeoutMs);
      timer.unref?.();
      const onAbort = () => this.finish(id, { approved: false, aborted: true });
      if (signal?.aborted) onAbort();
      else signal?.addEventListener("abort", onAbort, { once: true });
      return promise.finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      });
    };

    return { id, wait };
  }

  /** Returns false when the approval does not exist or belongs to another session. */
  decide(sessionId: string, approvalId: string, decision: ApprovalDecision, decidedBy: string): boolean {
    const entry = this.pending.get(approvalId);
    if (!entry || entry.sessionId !== sessionId) return false;
    entry.check?.(decision);
    this.finish(approvalId, { ...decision, decidedBy });
    return true;
  }

  hasPending(sessionId: string): boolean {
    for (const entry of this.pending.values()) if (entry.sessionId === sessionId) return true;
    return false;
  }

  private finish(id: string, outcome: ApprovalOutcome) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);
    entry.resolve(outcome);
  }
}

export interface EditedCall {
  args: Record<string, unknown>;
  /** The fields whose values changed. */
  changed: ApprovalField[];
}

/**
 * A call's arguments with the edits a person made to its approval's fields, or undefined when they changed nothing.
 * Throws a 400 when an edit is for something other than a field, isn't text, or leaves arguments the tool rejects.
 */
export function applyEdits(
  tool: ToolDefinition<any> | undefined,
  fields: ApprovalField[] | undefined,
  args: unknown,
  edits: ApprovalDecision["edits"],
): EditedCall | undefined {
  if (edits === undefined || edits === null) return undefined;
  if (typeof edits !== "object" || Array.isArray(edits)) throw agentError(400, "error.editNotAllowed", "bad_edit");
  const next = { ...((args && typeof args === "object" ? args : {}) as Record<string, unknown>) };
  const changed: ApprovalField[] = [];
  for (const [name, value] of Object.entries(edits)) {
    const field = fields?.find((candidate) => candidate.name === name);
    if (!field || typeof value !== "string") throw agentError(400, "error.editNotAllowed", "bad_edit");
    if (value === field.value) continue;
    next[name] = value;
    changed.push({ ...field, value });
  }
  if (!changed.length) return undefined;
  if (tool) {
    try {
      validateToolArguments(tool, { type: "toolCall", id: "edit", name: tool.name, arguments: next as ToolCall["arguments"] });
    } catch {
      throw agentError(400, "error.editInvalid", "bad_edit", { fields: changed.map((field) => field.label).join(", ") });
    }
  }
  return { args: next, changed };
}

/** The fields with the values a person changed them to, for the card once it's decided. */
export function withValues(fields: ApprovalField[], changed: ApprovalField[]): ApprovalField[] {
  return fields.map((field) => changed.find((edit) => edit.name === field.name) ?? field);
}

/** Tells the model a person changed its call before approving: the transcript keeps what it asked for. */
export function editNote(changed: ApprovalField[]): string {
  const values = Object.fromEntries(changed.map((field) => [field.name, field.value]));
  return `Before approving, a person changed ${changed.map((field) => field.name).join(", ")}. The call ran with their version: ${JSON.stringify(values)}`;
}
