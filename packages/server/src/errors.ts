/** An error with an HTTP status, surfaced to API clients as `{ error, code }`. */
export class AgentError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AgentError";
    this.status = status;
    this.code = code;
  }
}

export const notFound = (what: string) => new AgentError(404, `${what} not found.`, "not_found");
