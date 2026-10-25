import {
  applyEvent,
  expandTemplate,
  pendingApprovals,
  templatedName,
  touchedMessages,
  type AgentConfigInfo,
  type AgentEvent,
  type ApprovalDecision,
  type ApprovalInboxItem,
  type ChatMessage,
  type CreateScheduleRequest,
  type McpCompleteRequest,
  type McpPromptInfo,
  type McpResourceInfo,
  type McpResourceTemplateInfo,
  type MessagePart,
  type ModelInfo,
  type ModelRef,
  type NotificationEvent,
  type ScheduleInfo,
  type SessionSummary,
  type ThinkingLevel,
  type UpdateScheduleRequest,
} from "@klymbak/protocol";
import { AgentApiError, type AgentClient } from "./client.ts";
import { templateValues } from "./mentions.ts";
import type { Message, Text } from "./i18n.ts";
import type { MessageId } from "./messages.ts";
import { observe } from "./observe.ts";

export interface Toast {
  id: number;
  tone: "info" | "success" | "warning" | "danger";
  /** The store's own toasts are messages, put into words in the UI's language; a host's may be plain strings. */
  title: Text;
  body?: Text;
  sessionId?: string;
}

export interface Attachment {
  name: string;
  mimeType: string;
  data: string;
}

/** What a message brings along from MCP servers: resources mentioned with @ and a prompt chosen with /. */
export interface McpReferences {
  resources?: McpResourceInfo[];
  /** Resources from templates, each with its variables' values by name. */
  templates?: { template: McpResourceTemplateInfo; values: Record<string, string> }[];
  prompt?: McpPromptInfo;
  /** The prompt's argument values, by argument name. */
  arguments?: Record<string, string>;
}

export interface AgentState {
  ready: boolean;
  /** Why the agent can't be reached: the browser's or server's reason, or a message when there is none. */
  error: Text | null;
  config: AgentConfigInfo | null;
  sessions: SessionSummary[];
  sessionId: string | null;
  messages: ChatMessage[];
  loadingSession: boolean;
  running: boolean;
  runError: Text | null;
  model: ModelRef | null;
  thinkingLevel: ThinkingLevel;
  schedules: ScheduleInfo[];
  /** The approval inbox: what unattended runs left waiting that this person may decide, oldest first. */
  inbox: ApprovalInboxItem[];
  toasts: Toast[];
}

export interface AgentStoreOptions {
  client: AgentClient;
  /** localStorage key prefix for the chosen model. Set false to disable. */
  persist?: string | false;
  /**
   * Makes the state reactive for a framework that tracks deep changes itself: Vue passes
   * `reactive`. Without it, the store records writes and reports them through `subscribe`.
   */
  reactive?: <T extends object>(state: T) => T;
}

export type AgentStore = ReturnType<typeof createAgentStore>;

export function selectModels(state: AgentState): ModelInfo[] {
  return state.config?.models ?? [];
}

export function selectCurrentModel(state: AgentState): ModelInfo | undefined {
  return selectModels(state).find((m) => m.provider === state.model?.provider && m.id === state.model?.id);
}

export function selectApprovals(state: AgentState) {
  return pendingApprovals(state.messages);
}

export function selectCurrentSession(state: AgentState): SessionSummary | undefined {
  return state.sessions.find((s) => s.id === state.sessionId);
}

export function selectUnreadCount(state: AgentState): number {
  return state.sessions.filter((s) => s.unread).length;
}

/**
 * State and actions for one signed-in user: config, sessions, the open conversation,
 * schedules and notifications. Framework-agnostic; the UI bindings wrap it.
 */
export function createAgentStore({ client, persist = "klymbak", reactive }: AgentStoreOptions) {
  const listeners = new Set<() => void>();
  let version = 0;
  let notifyQueued = false;

  /** Bumps the version at once and tells subscribers once per batch of synchronous writes. */
  function changed() {
    version++;
    if (notifyQueued || !listeners.size) return;
    notifyQueued = true;
    queueMicrotask(() => {
      notifyQueued = false;
      for (const listener of [...listeners]) listener();
    });
  }

  const initial: AgentState = {
    ready: false,
    error: null,
    config: null,
    sessions: [],
    sessionId: null,
    messages: [],
    loadingSession: false,
    running: false,
    runError: null,
    model: null,
    thinkingLevel: "off",
    schedules: [],
    inbox: [],
    toasts: [],
  };
  const state = reactive ? reactive(initial) : observe(initial, changed);

  let streamController: AbortController | undefined;
  let eventsController: AbortController | undefined;
  let toastSeq = 0;
  /** What the person has open in the host app; sent with every run (see setContext). */
  let pageContext: string | undefined;
  /** Per message id: how many stream events changed that message in place. */
  const revisions = new Map<string, number>();

  const storageKey = persist ? `${persist}:model` : undefined;
  const load = (): { model?: ModelRef; thinkingLevel?: ThinkingLevel } => {
    try {
      return storageKey ? JSON.parse(localStorage.getItem(storageKey) ?? "{}") : {};
    } catch {
      return {};
    }
  };
  const save = () => {
    try {
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify({ model: state.model, thinkingLevel: state.thinkingLevel }));
    } catch {
      // Storage may be unavailable (private mode); the choice just won't persist.
    }
  };

  function toast(input: Omit<Toast, "id">, ttl = 7_000) {
    const item = { ...input, id: ++toastSeq };
    state.toasts.push(item);
    if (ttl > 0) setTimeout(() => dismissToast(item.id), ttl);
  }

  function dismissToast(id: number) {
    const index = state.toasts.findIndex((t) => t.id === id);
    if (index >= 0) state.toasts.splice(index, 1);
  }

  function upsertSession(summary: SessionSummary) {
    const index = state.sessions.findIndex((s) => s.id === summary.id);
    if (index >= 0) state.sessions[index] = summary;
    else state.sessions.unshift(summary);
    state.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function upsertSchedule(schedule: ScheduleInfo) {
    const index = state.schedules.findIndex((s) => s.id === schedule.id);
    if (index >= 0) state.schedules[index] = schedule;
    else state.schedules.push(schedule);
  }

  /** Shows a failed action as a toast: what failed, then the server's or browser's reason. Returns the reason. */
  function handleError(error: unknown, failed: MessageId): Text {
    const title: Message = { id: failed };
    const reason = error instanceof AgentApiError || error instanceof Error ? error.message : title;
    toast({ tone: "danger", title, body: reason });
    return reason;
  }

  /** Events from a run or attach stream, ignored once the user switched away. */
  function onSessionEvent(sessionId: string, event: AgentEvent) {
    if (state.sessionId !== sessionId) return;
    if (event.type === "message_start" && event.message.role === "user") {
      // Replace the optimistic copy of the prompt with the server's.
      const optimistic = state.messages.findIndex((m) => m.id.startsWith("local-"));
      if (optimistic >= 0) state.messages.splice(optimistic, 1);
    }
    const touched = touchedMessages(state.messages, event);
    applyEvent(state.messages, event);
    for (const id of touched === "all" ? state.messages.map((m) => m.id) : touched) revisions.set(id, (revisions.get(id) ?? 0) + 1);
    switch (event.type) {
      case "snapshot":
        state.running = event.session.running;
        upsertSession(event.session);
        break;
      case "run_start":
        state.running = true;
        state.runError = null;
        break;
      case "run_end":
        state.running = false;
        if (event.status === "error") state.runError = event.error ?? { id: "store.runFailed" };
        break;
      case "session_update":
        upsertSession(event.session);
        break;
    }
  }

  function onNotification(event: NotificationEvent) {
    switch (event.type) {
      case "hello":
        // A reconnect, after the first hello: catch up on approvals that came and went meanwhile.
        if (connected) void refreshInbox();
        connected = true;
        break;
      case "session_update":
        upsertSession(event.session);
        if (event.session.id === state.sessionId && !streamController) {
          // A run that started elsewhere, such as one an approval resumed: follow it.
          if (event.session.running && !state.running) attach(event.session.id);
          else if (!event.session.running && state.running) void openSession(event.session.id);
        }
        break;
      case "session_delete":
        state.sessions = state.sessions.filter((s) => s.id !== event.sessionId);
        state.inbox = state.inbox.filter((item) => item.sessionId !== event.sessionId);
        if (state.sessionId === event.sessionId) newSession();
        break;
      case "schedule_update":
        upsertSchedule(event.schedule);
        break;
      case "schedule_delete":
        state.schedules = state.schedules.filter((s) => s.id !== event.scheduleId);
        break;
      case "schedule_run":
        if (event.status === "completed") {
          toast(
            { tone: "success", title: { id: "toast.scheduleReady", values: { name: event.name } }, body: event.summary?.slice(0, 160), sessionId: event.sessionId },
            12_000,
          );
        } else if (event.status === "error") {
          toast({ tone: "danger", title: { id: "toast.scheduleFailed", values: { name: event.name } }, sessionId: event.sessionId });
        }
        break;
      case "approval_pending":
        if (event.sessionId !== state.sessionId) {
          toast({ tone: "warning", title: { id: "toast.approvalNeeded" }, body: event.title, sessionId: event.sessionId }, 15_000);
        }
        // The server knows who may decide it.
        void refreshInbox();
        break;
      case "approval_decided":
        dropFromInbox(event.approvalId);
        break;
      case "mcp_update":
        void refreshConfig();
        break;
    }
  }

  let configRequest = 0;

  async function refreshConfig() {
    const request = ++configRequest;
    try {
      const config = await client.getConfig();
      // After two quick language changes, the first answer can arrive last: keep the latest request's.
      if (request === configRequest) state.config = config;
    } catch {
      // Keep the previous config; the next notification will retry.
    }
  }

  let inboxRequest = 0;
  /** Whether the notification stream said hello since it was opened, so another hello means it reconnected. */
  let connected = false;

  /** Loads the approval inbox again. The latest request wins, so a burst of notifications can't leave an older answer. */
  async function refreshInbox() {
    const request = ++inboxRequest;
    try {
      const items = await client.listApprovals();
      if (request === inboxRequest) state.inbox = items;
    } catch {
      // Keep what's shown; the next notification tries again.
    }
  }

  function dropFromInbox(id: string) {
    if (state.inbox.some((item) => item.approval.id === id)) state.inbox = state.inbox.filter((item) => item.approval.id !== id);
  }

  let initializing: Promise<void> | undefined;

  /** Loads config, sessions and schedules and subscribes to notifications. Safe to call repeatedly. */
  function init(): Promise<void> {
    initializing ??= loadAll().finally(() => {
      if (!state.ready) initializing = undefined;
    });
    return initializing;
  }

  async function loadAll() {
    state.error = null;
    try {
      const [config, sessions] = await Promise.all([client.getConfig(), client.listSessions()]);
      state.config = config;
      state.sessions = sessions;
      const saved = load();
      const valid = (ref?: ModelRef | null) => ref && config.models.some((m) => m.provider === ref.provider && m.id === ref.id);
      state.model = valid(saved.model) ? saved.model! : (config.defaultModel ?? null);
      state.thinkingLevel = saved.thinkingLevel ?? "off";
      if (config.features.schedules) state.schedules = await client.listSchedules();
      state.ready = true;
      void refreshInbox();
      eventsController?.abort();
      eventsController = new AbortController();
      connected = false;
      void client.subscribe({ onEvent: onNotification, signal: eventsController.signal });
    } catch (error) {
      state.error = error instanceof Error ? error.message : { id: "store.unreachable" };
    }
  }

  function stopStream() {
    streamController?.abort();
    streamController = undefined;
  }

  function newSession() {
    stopStream();
    state.sessionId = null;
    state.messages = [];
    state.running = false;
    state.runError = null;
  }

  async function openSession(id: string) {
    stopStream();
    state.sessionId = id;
    state.loadingSession = true;
    state.runError = null;
    try {
      const detail = await client.getSession(id);
      if (state.sessionId !== id) return;
      state.messages = detail.messages;
      state.running = detail.running;
      if (detail.model && selectModels(state).some((m) => m.provider === detail.model!.provider && m.id === detail.model!.id)) {
        state.model = detail.model;
      }
      upsertSession(detail);
      if (detail.unread) void client.updateSession(id, { unread: false }).then(upsertSession);
      if (detail.running) attach(id);
    } catch (error) {
      handleError(error, "error.openSession");
      newSession();
    } finally {
      state.loadingSession = false;
    }
  }

  function attach(id: string) {
    const controller = new AbortController();
    streamController = controller;
    client
      .attach(id, { signal: controller.signal, onEvent: (event) => onSessionEvent(id, event) })
      .catch(() => undefined)
      .finally(() => {
        if (streamController === controller) streamController = undefined;
      });
  }

  /**
   * Sends a message, or steers the run under way with its text. MCP references go with new messages only: the server
   * reads the resources and gets the prompt before the run starts.
   */
  async function send(text: string, attachments: Attachment[] = [], references: McpReferences = {}) {
    const prompt = text.trim();
    const { resources = [], prompt: chosen } = references;
    const templated = (references.templates ?? []).map(({ template, values }) => ({ template, variables: templateValues(template, values) }));
    if (!prompt && !attachments.length && !resources.length && !templated.length && !chosen) return;
    if (state.running && state.sessionId) return steer(prompt);
    const values = Object.fromEntries(
      Object.entries(references.arguments ?? {})
        .map(([name, value]) => [name, value.trim()])
        .filter(([, value]) => value),
    );
    const args = Object.keys(values).length ? values : undefined;
    state.runError = null;
    try {
      if (!state.sessionId) {
        const created = await client.createSession({ model: state.model ?? undefined, thinkingLevel: state.thinkingLevel });
        state.sessionId = created.id;
        upsertSession(created);
      }
    } catch (error) {
      state.runError = handleError(error, "error.startSession");
      return;
    }
    const sessionId = state.sessionId!;
    // In the order the server shows them: the prompt, the text, images, then resources.
    const parts: MessagePart[] = [
      ...(chosen ? [{ type: "prompt" as const, server: chosen.server, name: chosen.name, title: chosen.title, arguments: args }] : []),
      ...(prompt ? [{ type: "text" as const, text: prompt }] : []),
      ...attachments.map((a) => ({ type: "image" as const, mimeType: a.mimeType, data: a.data })),
      ...resources.map(({ server, uri, name, mimeType }) => ({ type: "resource" as const, server, uri, name, mimeType })),
      ...templated.map(({ template, variables }) => ({
        type: "resource" as const,
        server: template.server,
        uri: expandTemplate(template.uriTemplate, variables),
        name: templatedName(template.name, variables),
        mimeType: template.mimeType,
      })),
    ];
    state.messages.push({ id: `local-${Date.now()}`, role: "user", createdAt: Date.now(), status: "done", parts });
    state.running = true;
    stopStream();
    const controller = new AbortController();
    streamController = controller;
    try {
      await client.run(
        sessionId,
        {
          prompt,
          images: attachments.length ? attachments.map(({ mimeType, data }) => ({ mimeType, data })) : undefined,
          model: state.model ?? undefined,
          thinkingLevel: state.thinkingLevel,
          context: pageContext,
          resources:
            resources.length || templated.length
              ? [
                  ...resources.map(({ server, uri }) => ({ server, uri })),
                  ...templated.map(({ template, variables }) => ({ server: template.server, template: template.uriTemplate, variables })),
                ]
              : undefined,
          mcpPrompt: chosen ? { server: chosen.server, name: chosen.name, arguments: args } : undefined,
        },
        { signal: controller.signal, onEvent: (event) => onSessionEvent(sessionId, event) },
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      if (state.sessionId === sessionId) {
        state.messages = state.messages.filter((m) => !m.id.startsWith("local-"));
        state.runError = error instanceof Error ? error.message : { id: "store.requestFailed" };
        state.running = false;
      }
    } finally {
      if (streamController === controller) streamController = undefined;
    }
  }

  async function steer(text: string) {
    if (!state.sessionId || !text) return;
    try {
      await client.steer(state.sessionId, text);
    } catch (error) {
      handleError(error, "error.steer");
    }
  }

  async function abort() {
    if (!state.sessionId) return;
    try {
      await client.abort(state.sessionId);
    } catch (error) {
      handleError(error, "error.abort");
    }
  }

  /**
   * Approves or denies a call in the open conversation or, with `sessionId`, in another one, such as an inbox item's.
   * Resolves to whether the decision was recorded; when it wasn't, a toast says why.
   */
  async function decide(approvalId: string, decision: ApprovalDecision, sessionId = state.sessionId): Promise<boolean> {
    if (!sessionId) return false;
    try {
      await client.decide(sessionId, approvalId, decision);
      dropFromInbox(approvalId);
      return true;
    } catch (error) {
      handleError(error, "error.decide");
      // Someone else may have decided it meanwhile.
      void refreshInbox();
      return false;
    }
  }

  function setModel(model: ModelRef, thinkingLevel?: ThinkingLevel) {
    state.model = model;
    const info = selectModels(state).find((m) => m.provider === model.provider && m.id === model.id);
    const level = thinkingLevel ?? state.thinkingLevel;
    state.thinkingLevel = info?.thinkingLevels.includes(level) ? level : "off";
    save();
  }

  function setThinkingLevel(level: ThinkingLevel) {
    state.thinkingLevel = level;
    save();
  }

  async function renameSession(id: string, title: string) {
    try {
      upsertSession(await client.updateSession(id, { title }));
    } catch (error) {
      handleError(error, "error.renameSession");
    }
  }

  async function deleteSession(id: string) {
    try {
      await client.deleteSession(id);
      state.sessions = state.sessions.filter((s) => s.id !== id);
      if (state.sessionId === id) newSession();
    } catch (error) {
      handleError(error, "error.deleteSession");
    }
  }

  async function createSchedule(input: CreateScheduleRequest) {
    try {
      const schedule = await client.createSchedule(input);
      upsertSchedule(schedule);
      toast({ tone: "success", title: { id: "toast.scheduled", values: { name: schedule.name } } });
      return schedule;
    } catch (error) {
      handleError(error, "error.createSchedule");
      throw error;
    }
  }

  async function updateSchedule(id: string, patch: UpdateScheduleRequest) {
    try {
      upsertSchedule(await client.updateSchedule(id, patch));
    } catch (error) {
      handleError(error, "error.updateSchedule");
    }
  }

  async function deleteSchedule(id: string) {
    try {
      await client.deleteSchedule(id);
      state.schedules = state.schedules.filter((s) => s.id !== id);
    } catch (error) {
      handleError(error, "error.deleteSchedule");
    }
  }

  async function runSchedule(id: string) {
    try {
      await client.runSchedule(id);
      toast({ tone: "info", title: { id: "toast.taskStarted" }, body: { id: "toast.taskStartedBody" } });
    } catch (error) {
      handleError(error, "error.runSchedule");
    }
  }

  async function addMcpServer(name: string, url: string, headers?: Record<string, string>) {
    const server = await client.addMcpServer({ name, url, headers });
    await refreshConfig();
    return server;
  }

  async function removeMcpServer(name: string) {
    try {
      await client.removeMcpServer(name);
      await refreshConfig();
    } catch (error) {
      handleError(error, "error.removeServer");
    }
  }

  /** Values an MCP server suggests for a prompt's argument or a template's variable; none when asking fails. */
  async function completeMcp(request: McpCompleteRequest): Promise<string[]> {
    try {
      return (await client.completeMcp(request)).values;
    } catch {
      return [];
    }
  }

  /**
   * Tells the agent what the person has open (the record on screen, the selected rows). It goes
   * with every message sent from now on, for the model only. Pass undefined to clear it.
   */
  function setContext(context: string | undefined) {
    pageContext = context?.trim() || undefined;
  }

  /**
   * The language for the server to write in: tool labels, approvals, notices and errors. The Klymbak components call
   * it with their `locale`; when it changes, the Tools panel loads again in the new language.
   */
  function setLocale(locale: string | undefined) {
    if (client.locale === locale) return;
    client.setLocale(locale);
    if (state.ready) void refreshConfig();
    // A first load under way asked in the old language: ask again once it has finished.
    else void initializing?.then(() => (state.ready ? refreshConfig() : undefined));
  }

  /** Stops all streams. A later init() starts over, e.g. when React StrictMode mounts a component twice. */
  function dispose() {
    stopStream();
    eventsController?.abort();
    initializing = undefined;
  }

  return {
    /** Read-only by convention: change it through the store's actions. */
    state: state as Readonly<AgentState>,
    client,
    /**
     * Calls `listener` after each batch of state changes and returns an unsubscribe function.
     * A store created with a `reactive` wrapper leaves change tracking to that framework.
     */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Grows with every change: the snapshot to give React's useSyncExternalStore. */
    getVersion: () => version,
    /**
     * Grows each time a stream event changes this message in place. With the message's identity it
     * tells a UI that memoizes messages when one needs to render again.
     */
    getMessageRevision: (id: string) => revisions.get(id) ?? 0,
    init,
    dispose,
    newSession,
    openSession,
    send,
    setContext,
    setLocale,
    steer,
    abort,
    decide,
    setModel,
    setThinkingLevel,
    renameSession,
    deleteSession,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    runSchedule,
    addMcpServer,
    removeMcpServer,
    completeMcp,
    refreshConfig,
    refreshInbox,
    toast,
    dismissToast,
  };
}
