import type { MessageValues } from "@klymbak/protocol";
import { t, type ServerMessageId } from "./messages.ts";

/** An error with an HTTP status, surfaced to API clients as `{ error, code }`. */
export class AgentError extends Error {
  readonly status: number;
  readonly code?: string;
  /** The message in a person's language, when the server wrote it. */
  readonly translate?: (locale: string | undefined) => string;

  constructor(status: number, message: string, code?: string, translate?: (locale: string | undefined) => string) {
    super(message);
    this.name = "AgentError";
    this.status = status;
    this.code = code;
    this.translate = translate;
  }
}

/** An AgentError with one of the server's own messages, which reaches the caller in their language. */
export function agentError(status: number, id: ServerMessageId, code?: string, values?: MessageValues): AgentError {
  return new AgentError(status, t(undefined, id, values), code, (locale) => t(locale, id, values));
}

export const notFound = (id: "error.sessionNotFound" | "error.scheduleNotFound") => agentError(404, id, "not_found");

/** An error's message for a person: in their language when the server wrote it, as it is otherwise. */
export function errorText(error: unknown, locale: string | undefined): string {
  if (error instanceof AgentError && error.translate) return error.translate(locale);
  return error instanceof Error ? error.message : String(error);
}
