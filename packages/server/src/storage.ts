import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  ChatMessage,
  ModelRef,
  ScheduleRunInfo,
  SessionSource,
  ThinkingLevel,
  UsageInfo,
} from "@klymbak/protocol";
import type { AgentUser } from "./types.ts";

export interface SessionRecord {
  id: string;
  /** Owner. */
  userId: string;
  /** Users with any of these roles can also open the session (used for scheduled reports). */
  audience?: string[];
  title: string;
  createdAt: number;
  updatedAt: number;
  source: SessionSource;
  scheduleId?: string;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  allowedTools: string[];
  unread?: boolean;
  usage?: UsageInfo;
  preview?: string;
  /** pi transcript: what the model sees. */
  messages: AgentMessage[];
  /** Rendered transcript: what the user sees. */
  view: ChatMessage[];
}

export type SessionSummaryRecord = Omit<SessionRecord, "messages" | "view">;

export interface ScheduleRecord {
  id: string;
  name: string;
  prompt: string;
  cron: string;
  timezone?: string;
  agent?: string;
  model?: string;
  enabled: boolean;
  source: "config" | "user" | "agent";
  /** Identity the task runs as. */
  owner?: AgentUser;
  audience?: string[];
  createdAt: number;
  lastRun?: ScheduleRunInfo;
}

export interface SessionFilter {
  userId: string;
  roles: string[];
}

/** Persistence for sessions and schedules. Implement this to store them in your own database. */
export interface AgentStorage {
  listSessions(filter: SessionFilter): Promise<SessionSummaryRecord[]>;
  getSession(id: string): Promise<SessionRecord | undefined>;
  saveSession(record: SessionRecord): Promise<void>;
  deleteSession(id: string): Promise<void>;
  listSchedules(): Promise<ScheduleRecord[]>;
  saveSchedule(record: ScheduleRecord): Promise<void>;
  deleteSchedule(id: string): Promise<void>;
}

export function canSeeSession(record: SessionSummaryRecord, filter: SessionFilter): boolean {
  return record.userId === filter.userId || (record.audience ?? []).some((role) => filter.roles.includes(role));
}

export function summarize(record: SessionRecord): SessionSummaryRecord {
  const { messages: _messages, view: _view, ...summary } = record;
  return summary;
}

const byUpdatedDesc = (a: SessionSummaryRecord, b: SessionSummaryRecord) => b.updatedAt - a.updatedAt;

export function memoryStorage(): AgentStorage {
  const sessions = new Map<string, SessionRecord>();
  const schedules = new Map<string, ScheduleRecord>();
  return {
    async listSessions(filter) {
      return [...sessions.values()].filter((s) => canSeeSession(s, filter)).map(summarize).sort(byUpdatedDesc);
    },
    async getSession(id) {
      const record = sessions.get(id);
      return record ? structuredClone(record) : undefined;
    },
    async saveSession(record) {
      sessions.set(record.id, structuredClone(record));
    },
    async deleteSession(id) {
      sessions.delete(id);
    },
    async listSchedules() {
      return [...schedules.values()].map((s) => structuredClone(s));
    },
    async saveSchedule(record) {
      schedules.set(record.id, structuredClone(record));
    },
    async deleteSchedule(id) {
      schedules.delete(id);
    },
  };
}

/**
 * Stores each session as a JSON file plus an index of summaries. Good for demos and
 * single-instance deployments; use a database adapter when running several instances.
 */
export function fileStorage(directory: string): AgentStorage {
  const sessionsDir = join(directory, "sessions");
  const indexPath = join(sessionsDir, "_index.json");
  const schedulesPath = join(directory, "schedules.json");
  let index: Map<string, SessionSummaryRecord> | undefined;
  let queue: Promise<unknown> = Promise.resolve();

  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task);
    queue = next.catch(() => undefined);
    return next;
  };

  const loadIndex = async () => {
    if (index) return index;
    await mkdir(sessionsDir, { recursive: true });
    const entries = await readJson<SessionSummaryRecord[]>(indexPath, []);
    index = new Map(entries.map((entry) => [entry.id, entry]));
    return index;
  };

  const sessionPath = (id: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid session id: ${id}`);
    return join(sessionsDir, `${id}.json`);
  };

  return {
    async listSessions(filter) {
      const entries = await loadIndex();
      return [...entries.values()].filter((s) => canSeeSession(s, filter)).sort(byUpdatedDesc);
    },
    async getSession(id) {
      return readJson<SessionRecord | undefined>(sessionPath(id), undefined);
    },
    saveSession(record) {
      return serialize(async () => {
        const entries = await loadIndex();
        await writeJson(sessionPath(record.id), record);
        entries.set(record.id, summarize(record));
        await writeJson(indexPath, [...entries.values()]);
      });
    },
    deleteSession(id) {
      return serialize(async () => {
        const entries = await loadIndex();
        await rm(sessionPath(id), { force: true });
        entries.delete(id);
        await writeJson(indexPath, [...entries.values()]);
      });
    },
    async listSchedules() {
      return readJson<ScheduleRecord[]>(schedulesPath, []);
    },
    saveSchedule(record) {
      return serialize(async () => {
        const all = await readJson<ScheduleRecord[]>(schedulesPath, []);
        const next = all.filter((s) => s.id !== record.id);
        next.push(record);
        await mkdir(directory, { recursive: true });
        await writeJson(schedulesPath, next);
      });
    },
    deleteSchedule(id) {
      return serialize(async () => {
        const all = await readJson<ScheduleRecord[]>(schedulesPath, []);
        await writeJson(
          schedulesPath,
          all.filter((s) => s.id !== id),
        );
      });
    },
  };
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const data = JSON.stringify(value);
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, data, "utf8");
  try {
    await rename(temp, path);
  } catch (error) {
    // Windows refuses to replace a file another process holds open (indexers, antivirus).
    if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
    await writeFile(path, data, "utf8");
    await rm(temp, { force: true });
  }
}
