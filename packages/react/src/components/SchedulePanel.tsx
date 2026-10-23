import { useState, type FormEvent } from "react";
import type { ScheduleInfo } from "@klymbak/protocol";
import { useAgentStore, useI18n } from "../context";
import { cx } from "../util";
import { KlIcon } from "./KlIcon";

/** Offered in the form, each described in words by describeCron. */
const PRESETS = ["0 8 * * 1-5", "0 9 * * 1", "0 18 * * *", "0 * * * *", "0 9 1 * *"];

const EMPTY_FORM = { name: "", cron: PRESETS[0]!, custom: "", prompt: "", agent: "" };
const statusTone = { completed: "success", error: "danger", aborted: "neutral" } as const;

export function SchedulePanel({ onOpenSession }: { onOpenSession?: (id: string) => void }) {
  const store = useAgentStore();
  const i18n = useI18n();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const { schedules } = store.state;
  const agents = store.state.config?.subagents ?? [];
  const field = (key: keyof typeof EMPTY_FORM) => ({
    value: form[key],
    onChange: (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value })),
  });

  function canManage(schedule: ScheduleInfo) {
    const user = store.state.config?.user;
    return Boolean(user && (schedule.ownerId === user.id || user.roles.includes("admin")));
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const cron = form.cron === "custom" ? form.custom.trim() : form.cron;
    if (!form.name.trim() || !form.prompt.trim() || !cron) return;
    setSaving(true);
    try {
      await store.createSchedule({ name: form.name, prompt: form.prompt, cron, agent: form.agent || undefined });
      setCreating(false);
      setForm(EMPTY_FORM);
    } catch {
      // The store already shows the error.
    } finally {
      setSaving(false);
    }
  }

  function openResult(schedule: ScheduleInfo) {
    if (!schedule.lastRun?.sessionId) return;
    void store.openSession(schedule.lastRun.sessionId);
    onOpenSession?.(schedule.lastRun.sessionId);
  }

  return (
    <div className="kl-schedules">
      <p className="kl-schedules__intro">{i18n.t("schedules.intro")}</p>

      {schedules.map((schedule) => (
        <article key={schedule.id} className={cx("kl-schedule", !schedule.enabled && "kl-schedule--paused")}>
          <div className="kl-schedule__top">
            <span className="kl-schedule__name">{schedule.name}</span>
            {canManage(schedule) && (
              <label className="kl-switch" title={i18n.t(schedule.enabled ? "schedules.pause" : "schedules.resume")}>
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  onChange={() => void store.updateSchedule(schedule.id, { enabled: !schedule.enabled })}
                />
                <span className="kl-switch__track" />
                <span className="kl-sr-only">{i18n.t(schedule.enabled ? "schedules.active" : "schedules.paused")}</span>
              </label>
            )}
          </div>
          <div className="kl-schedule__when">
            <KlIcon name="clock" size={12} /> {i18n.describeCron(schedule.cron)}
            {schedule.agent && <span className="kl-pill">{schedule.agent}</span>}
            {schedule.source !== "config" && (
              <span className="kl-pill kl-tone-info">{i18n.t(schedule.source === "agent" ? "schedules.madeInChat" : "schedules.yours")}</span>
            )}
          </div>
          <p className="kl-schedule__prompt">{schedule.prompt}</p>
          <div className="kl-schedule__foot">
            {schedule.running ? (
              <span className="kl-schedule__running">
                <span className="kl-spinner" /> {i18n.t("schedules.runningNow")}
              </span>
            ) : schedule.enabled && schedule.nextRunAt ? (
              <span className="kl-faint">{i18n.t("schedules.next", { when: i18n.timeAgo(schedule.nextRunAt) })}</span>
            ) : (
              <span className="kl-faint">{i18n.t("schedules.paused")}</span>
            )}
            {schedule.lastRun?.sessionId && (
              <button type="button" className="kl-schedule__last" onClick={() => openResult(schedule)}>
                <span className={`kl-pill kl-tone-${statusTone[schedule.lastRun.status]}`}>{i18n.t(`schedules.status.${schedule.lastRun.status}`)}</span>{" "}
                {i18n.timeAgo(schedule.lastRun.at)}
              </button>
            )}
          </div>
          <div className="kl-schedule__actions">
            <button type="button" className="kl-btn kl-btn--sm" disabled={schedule.running} onClick={() => void store.runSchedule(schedule.id)}>
              <KlIcon name="play" size={12} /> {i18n.t("schedules.runNow")}
            </button>
            {schedule.source !== "config" && canManage(schedule) && (
              <button type="button" className="kl-btn kl-btn--sm kl-btn--ghost kl-btn--danger" onClick={() => void store.deleteSchedule(schedule.id)}>
                {i18n.t("common.delete")}
              </button>
            )}
          </div>
        </article>
      ))}

      {!schedules.length && <p className="kl-faint">{i18n.t("schedules.empty")}</p>}

      {!creating ? (
        <button type="button" className="kl-btn" onClick={() => setCreating(true)}>
          <KlIcon name="plus" size={14} /> {i18n.t("schedules.new")}
        </button>
      ) : (
        <form className="kl-schedule-form" onSubmit={create}>
          <label className="kl-label">
            {i18n.t("schedules.name")} <input className="kl-input" required placeholder={i18n.t("schedules.namePlaceholder")} {...field("name")} />
          </label>
          <label className="kl-label">
            {i18n.t("schedules.when")}
            <select className="kl-select" {...field("cron")}>
              {PRESETS.map((cron) => (
                <option key={cron} value={cron}>
                  {i18n.describeCron(cron)}
                </option>
              ))}
              <option value="custom">{i18n.t("schedules.custom")}</option>
            </select>
          </label>
          {form.cron === "custom" && (
            <label className="kl-label">
              {i18n.t("schedules.cron")}
              <input className="kl-input kl-code" placeholder="30 7 * * 1-5" {...field("custom")} />
            </label>
          )}
          {agents.length > 0 && (
            <label className="kl-label">
              {i18n.t("schedules.runAs")}
              <select className="kl-select" {...field("agent")}>
                <option value="">{i18n.t("schedules.mainAgent")}</option>
                {agents.map((agent) => (
                  <option key={agent.name} value={agent.name}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="kl-label">
            {i18n.t("schedules.prompt")}
            <textarea className="kl-textarea" rows={3} required placeholder={i18n.t("schedules.promptPlaceholder")} {...field("prompt")} />
          </label>
          <div className="kl-schedule__actions">
            <button type="submit" className="kl-btn kl-btn--primary kl-btn--sm" disabled={saving}>
              {i18n.t("schedules.create")}
            </button>
            <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm" onClick={() => setCreating(false)}>
              {i18n.t("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
