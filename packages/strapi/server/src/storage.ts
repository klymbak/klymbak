import type { AgentStorage, ScheduleRecord, SessionRecord, SessionSummaryRecord } from "@klymbak/server";
import { CONVERSATION_UID, SCHEDULE_UID } from "./content-types/index.ts";

/** The slice of Strapi's Query Engine (strapi.db.query) the storage uses. */
export interface QueryEngine {
  findOne(params: { where: Record<string, unknown>; select?: string[] }): Promise<Record<string, any> | null>;
  findMany(params?: { where?: Record<string, unknown>; select?: string[] }): Promise<Record<string, any>[]>;
  create(params: { data: Record<string, unknown> }): Promise<unknown>;
  update(params: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<unknown>;
  delete(params: { where: Record<string, unknown> }): Promise<unknown>;
}

export interface StorageHost {
  db: { query(uid: string): QueryEngine };
}

const byUpdatedDesc = (a: SessionSummaryRecord, b: SessionSummaryRecord) => b.updatedAt - a.updatedAt;

function split(record: SessionRecord) {
  const { messages, view, ...summary } = record;
  return { summary, transcript: { messages, view } };
}

/**
 * Keeps conversations and schedules in Strapi's own database (two hidden plugin content types),
 * so they survive restarts and work with several Strapi instances behind a load balancer.
 * Listing reads only the summary column; a transcript is loaded when a conversation is opened.
 */
export function databaseStorage(strapi: StorageHost): AgentStorage {
  const conversations = () => strapi.db.query(CONVERSATION_UID);
  const schedules = () => strapi.db.query(SCHEDULE_UID);

  async function upsert(engine: QueryEngine, key: string, data: Record<string, unknown>) {
    const existing = await engine.findOne({ where: { key }, select: ["id"] });
    if (existing) await engine.update({ where: { id: existing.id }, data });
    else await engine.create({ data: { key, ...data } });
  }

  return {
    async listSessions({ userId, roles }) {
      // Own conversations, plus shared ones (scheduled reports) whose audience includes a role.
      const rows = await conversations().findMany({
        where: { $or: [{ owner: userId }, { audience: { $notNull: true } }] },
        select: ["owner", "audience", "summary"],
      });
      return rows
        .filter((row) => row.owner === userId || ((row.audience as string[] | null) ?? []).some((role) => roles.includes(role)))
        .map((row) => row.summary as SessionSummaryRecord)
        .sort(byUpdatedDesc);
    },
    async getSession(id) {
      const row = await conversations().findOne({ where: { key: id } });
      if (!row) return undefined;
      const transcript = (row.transcript ?? {}) as Pick<SessionRecord, "messages" | "view">;
      return { ...(row.summary as SessionSummaryRecord), messages: transcript.messages ?? [], view: transcript.view ?? [] };
    },
    async saveSession(record) {
      const { summary, transcript } = split(record);
      await upsert(conversations(), record.id, {
        owner: record.userId,
        audience: record.audience?.length ? record.audience : null,
        summary,
        transcript,
      });
    },
    async deleteSession(id) {
      await conversations().delete({ where: { key: id } });
    },
    async listSchedules() {
      const rows = await schedules().findMany({ select: ["record"] });
      return rows.map((row) => row.record as ScheduleRecord);
    },
    async saveSchedule(record) {
      await upsert(schedules(), record.id, { record });
    },
    async deleteSchedule(id) {
      await schedules().delete({ where: { key: id } });
    },
  };
}
