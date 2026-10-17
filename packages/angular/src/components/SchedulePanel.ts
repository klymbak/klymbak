import { ChangeDetectionStrategy, Component, output, signal } from "@angular/core";
import type { ScheduleInfo } from "@klymbak/protocol";
import { describeCron, timeAgo } from "@klymbak/client";
import { injectAgentState, injectStoreRef } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";

const PRESETS = [
  { label: "Every weekday at 08:00", cron: "0 8 * * 1-5" },
  { label: "Every Monday at 09:00", cron: "0 9 * * 1" },
  { label: "Every day at 18:00", cron: "0 18 * * *" },
  { label: "Every hour", cron: "0 * * * *" },
  { label: "First day of the month at 09:00", cron: "0 9 1 * *" },
];

const EMPTY_FORM = { name: "", cron: PRESETS[0]!.cron, custom: "", prompt: "", agent: "" };
const statusTone = { completed: "success", error: "danger", aborted: "neutral" } as const;

type Field = keyof typeof EMPTY_FORM;

@Component({
  selector: "kl-schedule-panel",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let s = state();
    @let agents = s.config?.subagents ?? [];
    <div class="kl-schedules">
      <p class="kl-schedules__intro">
        The agent runs these on its own and notifies you when results are ready. You can also ask in chat: “every Monday at 9, summarize refunds”.
      </p>

      @for (schedule of s.schedules; track schedule.id) {
        <article class="kl-schedule" [class.kl-schedule--paused]="!schedule.enabled">
          <div class="kl-schedule__top">
            <span class="kl-schedule__name">{{ schedule.name }}</span>
            @if (canManage(schedule)) {
              <label class="kl-switch" [title]="schedule.enabled ? 'Pause' : 'Resume'">
                <input type="checkbox" [checked]="schedule.enabled" (change)="store().updateSchedule(schedule.id, { enabled: !schedule.enabled })" />
                <span class="kl-switch__track"></span>
                <span class="kl-sr-only">{{ schedule.enabled ? "Active" : "Paused" }}</span>
              </label>
            }
          </div>
          <div class="kl-schedule__when">
            <svg klIcon name="clock" [size]="12" /> {{ describeCron(schedule.cron) }}
            @if (schedule.agent) {
              <span class="kl-pill">{{ schedule.agent }}</span>
            }
            @if (schedule.source !== "config") {
              <span class="kl-pill kl-tone-info">{{ schedule.source === "agent" ? "made in chat" : "yours" }}</span>
            }
          </div>
          <p class="kl-schedule__prompt">{{ schedule.prompt }}</p>
          <div class="kl-schedule__foot">
            @if (schedule.running) {
              <span class="kl-schedule__running"><span class="kl-spinner"></span> Running now</span>
            } @else if (schedule.enabled && schedule.nextRunAt) {
              <span class="kl-faint">Next {{ timeAgo(schedule.nextRunAt) }}</span>
            } @else {
              <span class="kl-faint">Paused</span>
            }
            @if (schedule.lastRun?.sessionId) {
              <button type="button" class="kl-schedule__last" (click)="openResult(schedule)">
                <span class="kl-pill kl-tone-{{ statusTone[schedule.lastRun!.status] }}">{{ schedule.lastRun!.status }}</span> {{ timeAgo(schedule.lastRun!.at) }}
              </button>
            }
          </div>
          <div class="kl-schedule__actions">
            <button type="button" class="kl-btn kl-btn--sm" [disabled]="schedule.running" (click)="store().runSchedule(schedule.id)"><svg klIcon name="play" [size]="12" /> Run now</button>
            @if (schedule.source !== "config" && canManage(schedule)) {
              <button type="button" class="kl-btn kl-btn--sm kl-btn--ghost kl-btn--danger" (click)="store().deleteSchedule(schedule.id)">Delete</button>
            }
          </div>
        </article>
      }

      @if (!s.schedules.length) {
        <p class="kl-faint">No scheduled tasks yet.</p>
      }

      @if (!creating()) {
        <button type="button" class="kl-btn" (click)="creating.set(true)"><svg klIcon name="plus" [size]="14" /> New scheduled task</button>
      } @else {
        @let f = form();
        <form class="kl-schedule-form" (submit)="create($event)">
          <label class="kl-label">
            Name
            <input #name class="kl-input" required placeholder="Weekly refund summary" [value]="f.name" (input)="set('name', name.value)" />
          </label>
          <label class="kl-label">
            When
            <select #cron class="kl-select" (change)="set('cron', cron.value)">
              @for (preset of PRESETS; track preset.cron) {
                <option [value]="preset.cron" [selected]="f.cron === preset.cron">{{ preset.label }}</option>
              }
              <option value="custom" [selected]="f.cron === 'custom'">Custom (cron)…</option>
            </select>
          </label>
          @if (f.cron === "custom") {
            <label class="kl-label">
              Cron expression
              <input #custom class="kl-input kl-code" placeholder="30 7 * * 1-5" [value]="f.custom" (input)="set('custom', custom.value)" />
            </label>
          }
          @if (agents.length > 0) {
            <label class="kl-label">
              Run as
              <select #agent class="kl-select" (change)="set('agent', agent.value)">
                <option value="" [selected]="!f.agent">Main agent</option>
                @for (option of agents; track option.name) {
                  <option [value]="option.name" [selected]="f.agent === option.name">{{ option.name }}</option>
                }
              </select>
            </label>
          }
          <label class="kl-label">
            What should it do?
            <textarea
              #prompt
              class="kl-textarea"
              rows="3"
              required
              placeholder="Summarize last week's refunds by reason and flag anything unusual."
              [value]="f.prompt"
              (input)="set('prompt', prompt.value)"
            ></textarea>
          </label>
          <div class="kl-schedule__actions">
            <button type="submit" class="kl-btn kl-btn--primary kl-btn--sm" [disabled]="saving()">Create</button>
            <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" (click)="creating.set(false)">Cancel</button>
          </div>
        </form>
      }
    </div>
  `,
})
export class SchedulePanel {
  readonly openSession = output<string>();
  protected readonly store = injectStoreRef();
  protected readonly state = injectAgentState();
  protected readonly creating = signal(false);
  protected readonly form = signal(EMPTY_FORM);
  protected readonly saving = signal(false);
  protected readonly PRESETS = PRESETS;
  protected readonly statusTone = statusTone;
  protected readonly describeCron = describeCron;
  protected readonly timeAgo = timeAgo;

  protected set(key: Field, value: string) {
    this.form.update((current) => ({ ...current, [key]: value }));
  }

  protected canManage(schedule: ScheduleInfo) {
    const user = this.state().config?.user;
    return Boolean(user && (schedule.ownerId === user.id || user.roles.includes("admin")));
  }

  protected async create(event: Event) {
    event.preventDefault();
    const form = this.form();
    const cron = form.cron === "custom" ? form.custom.trim() : form.cron;
    if (!form.name.trim() || !form.prompt.trim() || !cron) return;
    this.saving.set(true);
    try {
      await this.store().createSchedule({ name: form.name, prompt: form.prompt, cron, agent: form.agent || undefined });
      this.creating.set(false);
      this.form.set(EMPTY_FORM);
    } catch {
      // The store already shows the error.
    } finally {
      this.saving.set(false);
    }
  }

  protected openResult(schedule: ScheduleInfo) {
    const sessionId = schedule.lastRun?.sessionId;
    if (!sessionId) return;
    void this.store().openSession(sessionId);
    this.openSession.emit(sessionId);
  }
}
