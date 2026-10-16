import {
  readSseStream,
  type AddMcpServerRequest,
  type AgentConfigInfo,
  type AgentEvent,
  type ApprovalDecision,
  type CreateScheduleRequest,
  type CreateSessionRequest,
  type McpServerInfo,
  type NotificationEvent,
  type RunRequest,
  type ScheduleInfo,
  type SessionDetail,
  type SessionSummary,
  type UpdateScheduleRequest,
  type UpdateSessionRequest,
} from "@klymbak/protocol";

type HeaderValues = Record<string, string>;

export interface AgentClientOptions {
  /** Where the agent routes are mounted, e.g. "/api/agent" or "https://api.example.com/agent". */
  baseUrl: string;
  /** Extra headers (auth tokens...). A function is called before every request. */
  headers?: HeaderValues | (() => HeaderValues | Promise<HeaderValues>);
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}

export class AgentApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AgentApiError";
    this.status = status;
    this.code = code;
  }
}

export interface StreamOptions<E> {
  onEvent(event: E): void;
  signal?: AbortSignal;
}

export type AgentClient = ReturnType<typeof createAgentClient>;

/** Typed client for the @klymbak/server HTTP API. Framework-agnostic. */
export function createAgentClient(options: AgentClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, "");
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function headers(extra?: HeaderValues): Promise<HeaderValues> {
    const custom = typeof options.headers === "function" ? await options.headers() : options.headers;
    return { ...custom, ...extra };
  }

  async function failure(response: Response): Promise<AgentApiError> {
    let message =
      response.status >= 500
        ? `The agent server isn't responding (HTTP ${response.status}). Try again in a moment.`
        : `Request failed (HTTP ${response.status}).`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: string; code?: string };
      message = body.error ?? message;
      code = body.code;
    } catch {
      // Not JSON; keep the generic message.
    }
    return new AgentApiError(response.status, message, code);
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      method,
      credentials: options.credentials,
      headers: await headers(body === undefined ? undefined : { "content-type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw await failure(response);
    if (response.status === 204 || response.status === 202) return undefined as T;
    return (await response.json()) as T;
  }

  async function stream<E>(method: string, path: string, body: unknown, { onEvent, signal }: StreamOptions<E>): Promise<void> {
    const response = await doFetch(`${base}${path}`, {
      method,
      signal,
      credentials: options.credentials,
      headers: await headers({ accept: "text/event-stream", ...(body === undefined ? {} : { "content-type": "application/json" }) }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw await failure(response);
    if (!response.body) throw new AgentApiError(500, "The server did not return a stream.");
    await readSseStream(response.body, (message) => {
      try {
        onEvent(JSON.parse(message.data) as E);
      } catch (error) {
        console.error("[klymbak] bad event", error);
      }
    });
  }

  const enc = encodeURIComponent;

  return {
    getConfig: () => request<AgentConfigInfo>("GET", "/config"),

    listSessions: () => request<SessionSummary[]>("GET", "/sessions"),
    createSession: (body: CreateSessionRequest = {}) => request<SessionDetail>("POST", "/sessions", body),
    getSession: (id: string) => request<SessionDetail>("GET", `/sessions/${enc(id)}`),
    updateSession: (id: string, body: UpdateSessionRequest) => request<SessionSummary>("PATCH", `/sessions/${enc(id)}`, body),
    deleteSession: (id: string) => request<void>("DELETE", `/sessions/${enc(id)}`),

    /** Starts a run and streams its events until it ends. */
    run: (id: string, body: RunRequest, opts: StreamOptions<AgentEvent>) => stream("POST", `/sessions/${enc(id)}/runs`, body, opts),
    /** Follows a session: a snapshot first, then live events. */
    attach: (id: string, opts: StreamOptions<AgentEvent>) => stream("GET", `/sessions/${enc(id)}/stream`, undefined, opts),
    abort: (id: string) => request<void>("POST", `/sessions/${enc(id)}/abort`),
    steer: (id: string, text: string) => request<void>("POST", `/sessions/${enc(id)}/steer`, { text }),
    decide: (id: string, approvalId: string, decision: ApprovalDecision) =>
      request<void>("POST", `/sessions/${enc(id)}/approvals/${enc(approvalId)}`, decision),

    listSchedules: () => request<ScheduleInfo[]>("GET", "/schedules"),
    createSchedule: (body: CreateScheduleRequest) => request<ScheduleInfo>("POST", "/schedules", body),
    updateSchedule: (id: string, body: UpdateScheduleRequest) => request<ScheduleInfo>("PATCH", `/schedules/${enc(id)}`, body),
    deleteSchedule: (id: string) => request<void>("DELETE", `/schedules/${enc(id)}`),
    runSchedule: (id: string) => request<void>("POST", `/schedules/${enc(id)}/run`),

    listMcpServers: () => request<McpServerInfo[]>("GET", "/mcp"),
    addMcpServer: (body: AddMcpServerRequest) => request<McpServerInfo>("POST", "/mcp", body),
    removeMcpServer: (name: string) => request<void>("DELETE", `/mcp/${enc(name)}`),

    /**
     * Subscribes to notifications (schedule results, session list changes...).
     * Reconnects with backoff until the signal aborts.
     */
    async subscribe({ onEvent, signal }: StreamOptions<NotificationEvent>): Promise<void> {
      let delay = 1_000;
      while (!signal?.aborted) {
        try {
          await stream("GET", "/events", undefined, {
            signal,
            onEvent: (event: NotificationEvent) => {
              delay = 1_000;
              onEvent(event);
            },
          });
        } catch (error) {
          if (signal?.aborted) return;
          if (error instanceof AgentApiError && error.status === 401) return;
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 30_000);
      }
    },
  };
}
