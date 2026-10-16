import { randomUUID } from "node:crypto";
import type { ApprovalDecision } from "@klymbak/protocol";

export interface ApprovalOutcome extends ApprovalDecision {
  expired?: boolean;
  aborted?: boolean;
  decidedBy?: string;
}

interface PendingApproval {
  id: string;
  sessionId: string;
  toolCallId: string;
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

  create(sessionId: string, toolCallId: string) {
    const id = randomUUID();
    let settle!: (outcome: ApprovalOutcome) => void;
    const promise = new Promise<ApprovalOutcome>((resolve) => (settle = resolve));
    const entry: PendingApproval = { id, sessionId, toolCallId, resolve: settle };
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
