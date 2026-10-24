import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { Type } from "@earendil-works/pi-ai";
import { ui, validLocale, type CreateScheduleRequest, type ScheduleInfo, type UpdateScheduleRequest } from "@klymbak/protocol";
import { agentError, notFound } from "./errors.ts";
import { t } from "./messages.ts";
import type { AgentRuntime } from "./runtime.ts";
import type { AgentStorage, ScheduleRecord } from "./storage.ts";
import { defineTool } from "./tool.ts";
import type { AgentUser, ScheduleDefinition, ToolDefinition } from "./types.ts";

interface Job {
  record: ScheduleRecord;
  cron: Cron;
  running: boolean;
}

/**
 * Runs prompts on cron schedules. Each run is an unattended session owned by the
 * schedule's owner; people in its audience see the result and get a notification.
 */
export class Scheduler {
  private readonly jobs = new Map<string, Job>();
  private readonly runtime: AgentRuntime;
  private readonly storage: AgentStorage;
  private readonly definitions: ScheduleDefinition[];

  constructor(runtime: AgentRuntime, storage: AgentStorage, definitions: ScheduleDefinition[]) {
    this.runtime = runtime;
    this.storage = storage;
    this.definitions = definitions;
  }

  async start() {
    const stored = await this.storage.listSchedules();
    for (const definition of this.definitions) {
      const previous = stored.find((s) => s.id === definition.id);
      this.install({
        id: definition.id,
        name: definition.name,
        prompt: definition.prompt,
        cron: definition.cron,
        timezone: definition.timezone,
        agent: definition.agent,
        model: definition.model,
        enabled: previous?.enabled ?? definition.enabled ?? true,
        source: "config",
        owner: this.runtime.systemUser,
        audience: definition.audience ?? ["admin"],
        createdAt: previous?.createdAt ?? Date.now(),
        lastRun: previous?.lastRun,
      });
    }
    for (const record of stored) {
      if (record.source !== "config") this.install(record);
    }
  }

  stop() {
    for (const job of this.jobs.values()) job.cron.stop();
    this.jobs.clear();
  }

  list(user: AgentUser): ScheduleInfo[] {
    return [...this.jobs.values()]
      .filter((job) => this.canSee(job.record, user))
      .map((job) => this.describe(job))
      .sort((a, b) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
  }

  async create(input: CreateScheduleRequest, owner: AgentUser, source: "user" | "agent"): Promise<ScheduleInfo> {
    if (!input.name?.trim() || !input.prompt?.trim()) throw agentError(400, "error.scheduleFields");
    this.nextRun(input.cron, input.timezone);
    if (input.agent && !this.runtime.subagents.some((s) => s.name === input.agent)) {
      throw agentError(400, "error.unknownAgent", undefined, { agent: input.agent });
    }
    const record: ScheduleRecord = {
      id: randomUUID().slice(0, 8),
      name: input.name.trim().slice(0, 80),
      prompt: input.prompt.trim(),
      cron: input.cron.trim(),
      timezone: input.timezone,
      agent: input.agent,
      enabled: input.enabled ?? true,
      source,
      // The owner's language too, so unattended runs write labels and notices in it.
      owner: { id: owner.id, name: owner.name, roles: [...owner.roles], locale: owner.locale },
      createdAt: Date.now(),
    };
    await this.storage.saveSchedule(record);
    const job = this.install(record);
    this.announce(job);
    return this.describe(job);
  }

  async update(id: string, patch: UpdateScheduleRequest, user: AgentUser): Promise<ScheduleInfo> {
    const job = this.manageable(id, user);
    const record = { ...job.record };
    if (record.source === "config" && (patch.cron || patch.prompt || patch.name)) {
      throw agentError(400, "error.builtinSchedulePatch");
    }
    if (patch.cron !== undefined || patch.timezone !== undefined) this.nextRun(patch.cron ?? record.cron, patch.timezone ?? record.timezone);
    Object.assign(record, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    await this.storage.saveSchedule(record);
    const updated = this.install(record);
    this.announce(updated);
    return this.describe(updated);
  }

  async remove(id: string, user: AgentUser) {
    const job = this.manageable(id, user);
    if (job.record.source === "config") throw agentError(400, "error.builtinScheduleDelete");
    job.cron.stop();
    this.jobs.delete(id);
    await this.storage.deleteSchedule(id);
    this.runtime.notify({ type: "schedule_delete", scheduleId: id }, this.scope(job.record));
  }

  /** Starts a run immediately. Resolves once it has started, not when it finishes. */
  runNow(id: string, user: AgentUser) {
    const job = this.jobs.get(id);
    if (!job || !this.canSee(job.record, user)) throw notFound("error.scheduleNotFound");
    if (job.running) throw agentError(409, "error.scheduleRunning", "busy");
    void this.execute(id);
  }

  private install(record: ScheduleRecord): Job {
    this.jobs.get(record.id)?.cron.stop();
    const cron = new Cron(
      record.cron,
      {
        name: `klymbak:${record.id}`,
        timezone: record.timezone ?? this.runtime.timezone,
        paused: !record.enabled,
        protect: true,
        catch: (error) => this.runtime.logger.error(`Schedule ${record.id} failed`, String(error)),
      },
      () => this.execute(record.id),
    );
    const job: Job = { record, cron, running: false };
    this.jobs.set(record.id, job);
    return job;
  }

  private async execute(id: string) {
    const job = this.jobs.get(id);
    if (!job || job.running) return;
    const { record } = job;
    job.running = true;
    this.announce(job);

    const startedAt = Date.now();
    const scope = this.scope(record);
    try {
      const owner = record.owner ?? this.runtime.systemUser;
      const date = new Date().toLocaleDateString(validLocale(owner.locale) ?? "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: record.timezone ?? this.runtime.timezone,
      });
      const result = await this.runtime.runHeadless({
        user: owner,
        prompt: record.prompt,
        title: `${record.name} · ${date}`,
        scheduleId: record.id,
        agent: record.agent,
        model: record.model,
        audience: record.audience,
        onStart: (sessionId) =>
          this.runtime.notify(
            { type: "schedule_run", scheduleId: id, name: record.name, sessionId, status: "started", at: startedAt },
            scope,
          ),
      });
      record.lastRun = { at: startedAt, status: result.status, sessionId: result.sessionId, summary: result.text.slice(0, 400) };
      this.runtime.notify(
        {
          type: "schedule_run",
          scheduleId: id,
          name: record.name,
          sessionId: result.sessionId,
          status: result.status,
          summary: record.lastRun.summary,
          at: Date.now(),
        },
        scope,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.lastRun = { at: startedAt, status: "error", sessionId: "", summary: message };
      this.runtime.logger.error(`Scheduled task "${record.name}" failed`, message);
    } finally {
      job.running = false;
      await this.storage.saveSchedule(record).catch(() => undefined);
      this.announce(job);
    }
  }

  private nextRun(expression: string, timezone?: string): Date | null {
    try {
      const probe = new Cron(expression, { timezone: timezone ?? this.runtime.timezone, paused: true });
      const next = probe.nextRun();
      probe.stop();
      return next;
    } catch (error) {
      throw agentError(400, "error.invalidCron", "invalid_cron", { expression, error: error instanceof Error ? error.message : String(error) });
    }
  }

  private canSee(record: ScheduleRecord, user: AgentUser) {
    return record.owner?.id === user.id || (record.audience ?? []).some((role) => user.roles.includes(role));
  }

  private manageable(id: string, user: AgentUser): Job {
    const job = this.jobs.get(id);
    if (!job || !this.canSee(job.record, user)) throw notFound("error.scheduleNotFound");
    if (job.record.owner?.id !== user.id && !user.roles.includes("admin")) {
      throw agentError(403, "error.scheduleForbidden", "forbidden");
    }
    return job;
  }

  private scope(record: ScheduleRecord) {
    return { userId: record.owner?.id, roles: record.audience };
  }

  private announce(job: Job) {
    this.runtime.notify({ type: "schedule_update", schedule: this.describe(job) }, this.scope(job.record));
  }

  private describe(job: Job): ScheduleInfo {
    const { record } = job;
    return {
      id: record.id,
      name: record.name,
      prompt: record.prompt,
      cron: record.cron,
      timezone: record.timezone ?? this.runtime.timezone,
      agent: record.agent,
      enabled: record.enabled,
      source: record.source,
      ownerId: record.owner?.id,
      nextRunAt: record.enabled ? job.cron.nextRun()?.getTime() : undefined,
      running: job.running,
      lastRun: record.lastRun,
    };
  }

  /** Tools that let the agent manage the user's schedules from chat. */
  tools(): ToolDefinition<any>[] {
    return [
      defineTool({
        name: "schedule_task",
        label: (locale) => t(locale, "tool.schedule.label"),
        summary: (locale) => t(locale, "tool.schedule.summary"),
        source: "builtin",
        description:
          "Create a recurring task that runs unattended on a cron schedule, e.g. a Monday 9:00 report. The prompt must be self-contained (it runs without this conversation) and should read and report rather than make changes. Cron fields: minute hour day-of-month month day-of-week.",
        parameters: Type.Object({
          name: Type.String({ description: "Short name, e.g. 'Weekly refund summary'" }),
          cron: Type.String({ description: "Cron expression, e.g. '0 9 * * 1' for Mondays at 09:00" }),
          prompt: Type.String({ description: "What the agent should do on each run" }),
          agent: Type.Optional(Type.String({ description: "Specialist to run the task, if any" })),
        }),
        execute: async (args, ctx) => {
          const schedule = await this.create({ ...args, timezone: this.runtime.timezone }, ctx.user, "agent");
          const next = schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString("en-US", { timeZone: schedule.timezone }) : "never";
          const locale = ctx.user.locale;
          return {
            text: `Scheduled "${schedule.name}" (id ${schedule.id}, cron "${schedule.cron}", ${schedule.timezone}). Next run: ${next}.`,
            ui: ui.keyValue(
              [
                { label: t(locale, "schedule.task"), value: schedule.name },
                { label: t(locale, "schedule.cron"), value: schedule.cron, format: "code" },
                { label: t(locale, "schedule.nextRun"), value: schedule.nextRunAt, format: "datetime" },
                { label: t(locale, "schedule.prompt"), value: schedule.prompt },
              ],
              t(locale, "schedule.created"),
            ),
          };
        },
      }),
      defineTool({
        name: "list_scheduled_tasks",
        label: (locale) => t(locale, "tool.listSchedules.label"),
        summary: (locale) => t(locale, "tool.listSchedules.summary"),
        source: "builtin",
        readOnly: true,
        description: "List recurring tasks the user can see, with their schedule, status and last result.",
        parameters: Type.Object({}),
        execute: async (_args, ctx) => {
          const schedules = this.list(ctx.user);
          const locale = ctx.user.locale;
          const [active, paused] = [t(locale, "schedule.active"), t(locale, "schedule.paused")];
          return {
            data: schedules.map((s) => ({ id: s.id, name: s.name, cron: s.cron, enabled: s.enabled, prompt: s.prompt, lastRun: s.lastRun?.status })),
            ui: ui.table({
              title: t(locale, "schedule.list"),
              columns: [
                { key: "name", label: t(locale, "schedule.task") },
                { key: "cron", label: t(locale, "schedule.cron"), format: "code" },
                { key: "nextRunAt", label: t(locale, "schedule.nextRun"), format: "datetime" },
                { key: "state", label: t(locale, "schedule.state"), format: "badge", tones: { [active]: "success", [paused]: "neutral" } },
              ],
              rows: schedules.map((s) => ({ ...s, state: s.enabled ? active : paused })),
            }),
          };
        },
      }),
      defineTool({
        name: "cancel_scheduled_task",
        label: (locale) => t(locale, "tool.cancelSchedule.label"),
        summary: (locale) => t(locale, "tool.cancelSchedule.summary"),
        source: "builtin",
        description: "Delete a recurring task the user created. Built-in tasks can only be paused from the Schedules panel.",
        parameters: Type.Object({ id: Type.String({ description: "Schedule id from list_scheduled_tasks" }) }),
        execute: async ({ id }, ctx) => {
          await this.remove(id, ctx.user);
          return `Deleted scheduled task ${id}.`;
        },
      }),
    ];
  }
}
