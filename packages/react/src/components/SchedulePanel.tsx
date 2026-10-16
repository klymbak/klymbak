import { useState, type FormEvent } from "react";
import type { ScheduleInfo } from "@klymbak/protocol";
import { describeCron, timeAgo } from "@klymbak/client";
import { useAgentStore } from "../context";
import { cx } from "../util";
import { KlIcon } from "./KlIcon";

const PRESETS = [
  { label: "Every weekday at 08:00", cron: "0 8 * * 1-5" },
  { label: "Every Monday at 09:00", cron: "0 9 * * 1" },
  { label: "Every day at 18:00", cron: "0 18 * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "First day of the month at 09:00", cron: "0 9 1 * *" },
];

const EMPTY_FORM = { name: "", cron: PRESETS[0]!.cron, custom: "", prompt: "", agent: "" };
const statusTone = { completed: "success", error: "danger", aborted: "neutral" } as const;

export function SchedulePanel({ onOpenSession }: { onOpenSession?: (id: string) => void }) {
  const store = useAgentStore();
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
      <p className="kl-schedules__intro">
        The agent runs these on its own and notifies you when results are ready. You can also ask in chat: “every Monday at 9, summarize refunds”.
      </p>

      {schedules.map((schedule) => (
        <article key={schedule.id} className={cx("kl-schedule", !schedule.enabled && "kl-schedule--paused")}>
          <div className="kl-schedule__top">
            <span className="kl-schedule__name">{schedule.name}</span>
            {canManage(schedule) && (
              <label className="kl-switch" title={schedule.enabled ? "Pause" : "Resume"}>
                <input
                  type="checkbox"
                  checked={schedule.enabled}
                  onChange={() => void store.updateSchedule(schedule.id, { enabled: !schedule.enabled })}
                />
                <span className="kl-switch__track" />
                <span className="kl-sr-only">{schedule.enabled ? "Active" : "Paused"}</span>
              </label>
            )}
          </div>
          <div className="kl-schedule__when">
            <KlIcon name="clock" size={12} /> {describeCron(schedule.cron)}
            {schedule.agent && <span className="kl-pill">{schedule.agent}</span>}
            {schedule.source !== "config" && <span className="kl-pill kl-tone-info">{schedule.source === "agent" ? "made in chat" : "yours"}</span>}
          </div>
          <p className="kl-schedule__prompt">{schedule.prompt}</p>
          <div className="kl-schedule__foot">
            {schedule.running ? (
              <span className="kl-schedule__running">
                <span className="kl-spinner" /> Running now
              </span>
            ) : schedule.enabled && schedule.nextRunAt ? (
              <span className="kl-faint">Next {timeAgo(schedule.nextRunAt)}</span>
            ) : (
              <span className="kl-faint">Paused</span>
            )}
            {schedule.lastRun?.sessionId && (
              <button type="button" className="kl-schedule__last" onClick={() => openResult(schedule)}>
                <span className={`kl-pill kl-tone-${statusTone[schedule.lastRun.status]}`}>{schedule.lastRun.status}</span> {timeAgo(schedule.lastRun.at)}
              </button>
            )}
          </div>
          <div className="kl-schedule__actions">
            <button type="button" className="kl-btn kl-btn--sm" disabled={schedule.running} onClick={() => void store.runSchedule(schedule.id)}>
              <KlIcon name="play" size={12} /> Run now
            </button>
            {schedule.source !== "config" && canManage(schedule) && (
              <button type="button" className="kl-btn kl-btn--sm kl-btn--ghost kl-btn--danger" onClick={() => void store.deleteSchedule(schedule.id)}>
                Delete
              </button>
            )}
          </div>
        </article>
      ))}

      {!schedules.length && <p className="kl-faint">No scheduled tasks yet.</p>}

      {!creating ? (
        <button type="button" className="kl-btn" onClick={() => setCreating(true)}>
          <KlIcon name="plus" size={14} /> New scheduled task
        </button>
      ) : (
        <form className="kl-schedule-form" onSubmit={create}>
          <label className="kl-label">
            Name <input className="kl-input" required placeholder="Weekly refund summary" {...field("name")} />
          </label>
          <label className="kl-label">
            When
            <select className="kl-select" {...field("cron")}>
              {PRESETS.map((preset) => (
                <option key={preset.cron} value={preset.cron}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom (cron)…</option>
            </select>
          </label>
          {form.cron === "custom" && (
            <label className="kl-label">
              Cron expression
              <input className="kl-input kl-code" placeholder="30 7 * * 1-5" {...field("custom")} />
            </label>
          )}
          {agents.length > 0 && (
            <label className="kl-label">
              Run as
              <select className="kl-select" {...field("agent")}>
                <option value="">Main agent</option>
                {agents.map((agent) => (
                  <option key={agent.name} value={agent.name}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="kl-label">
            What should it do?
            <textarea
              className="kl-textarea"
              rows={3}
              required
              placeholder="Summarize last week's refunds by reason and flag anything unusual."
              {...field("prompt")}
            />
          </label>
          <div className="kl-schedule__actions">
            <button type="submit" className="kl-btn kl-btn--primary kl-btn--sm" disabled={saving}>
              Create
            </button>
            <button type="button" className="kl-btn kl-btn--ghost kl-btn--sm" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
