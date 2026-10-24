import { ChangeDetectionStrategy, Component, output, signal } from "@angular/core";
import type { ScheduleInfo } from "@klymbak/protocol";
import { injectAgentState, injectI18n, injectStoreRef } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";

/** Offered in the form, each described in words by describeCron. */
const PRESETS = ["0 8 * * 1-5", "0 9 * * 1", "0 18 * * *", "0 * * * *", "0 9 1 * *"];

const EMPTY_FORM = { name: "", cron: PRESETS[0]!, custom: "", prompt: "", agent: "" };
const statusTone = { completed: "success", error: "danger", aborted: "neutral" } as const;
const statusLabels = { completed: "schedules.status.completed", error: "schedules.status.error", aborted: "schedules.status.aborted" } as const;

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
      <p class="kl-schedules__intro">{{ i18n().t("schedules.intro") }}</p>

      @for (schedule of s.schedules; track schedule.id) {
        <article class="kl-schedule" [class.kl-schedule--paused]="!schedule.enabled">
          <div class="kl-schedule__top">
            <span class="kl-schedule__name">{{ schedule.name }}</span>
            @if (canManage(schedule)) {
              <label class="kl-switch" [title]="i18n().t(schedule.enabled ? 'schedules.pause' : 'schedules.resume')">
                <input type="checkbox" [checked]="schedule.enabled" (change)="store().updateSchedule(schedule.id, { enabled: !schedule.enabled })" />
                <span class="kl-switch__track"></span>
                <span class="kl-sr-only">{{ i18n().t(schedule.enabled ? "schedules.active" : "schedules.paused") }}</span>
              </label>
            }
          </div>
          <div class="kl-schedule__when">
            <svg klIcon name="clock" [size]="12" /> {{ i18n().describeCron(schedule.cron) }}
            @if (schedule.agent) {
              <span class="kl-pill">{{ schedule.agent }}</span>
            }
            @if (schedule.source !== "config") {
              <span class="kl-pill kl-tone-info">{{ i18n().t(schedule.source === "agent" ? "schedules.madeInChat" : "schedules.yours") }}</span>
            }
          </div>
          <p class="kl-schedule__prompt">{{ schedule.prompt }}</p>
          <div class="kl-schedule__foot">
            @if (schedule.running) {
              <span class="kl-schedule__running"><span class="kl-spinner"></span> {{ i18n().t("schedules.runningNow") }}</span>
            } @else if (schedule.enabled && schedule.nextRunAt) {
              <span class="kl-faint">{{ i18n().t("schedules.next", { when: i18n().timeAgo(schedule.nextRunAt) }) }}</span>
            } @else {
              <span class="kl-faint">{{ i18n().t("schedules.paused") }}</span>
            }
            @if (schedule.lastRun; as lastRun) {
              @if (lastRun.sessionId) {
                <button type="button" class="kl-schedule__last" (click)="openResult(schedule)">
                  <span class="kl-pill kl-tone-{{ statusTone[lastRun.status] }}">{{ i18n().t(statusLabels[lastRun.status]) }}</span> {{ i18n().timeAgo(lastRun.at) }}
                </button>
              }
            }
          </div>
          <div class="kl-schedule__actions">
            <button type="button" class="kl-btn kl-btn--sm" [disabled]="schedule.running" (click)="store().runSchedule(schedule.id)">
              <svg klIcon name="play" [size]="12" /> {{ i18n().t("schedules.runNow") }}
            </button>
            @if (schedule.source !== "config" && canManage(schedule)) {
              <button type="button" class="kl-btn kl-btn--sm kl-btn--ghost kl-btn--danger" (click)="store().deleteSchedule(schedule.id)">{{ i18n().t("common.delete") }}</button>
            }
          </div>
        </article>
      }

      @if (!s.schedules.length) {
        <p class="kl-faint">{{ i18n().t("schedules.empty") }}</p>
      }

      @if (!creating()) {
        <button type="button" class="kl-btn" (click)="creating.set(true)"><svg klIcon name="plus" [size]="14" /> {{ i18n().t("schedules.new") }}</button>
      } @else {
        @let f = form();
        <form class="kl-schedule-form" (submit)="create($event)">
          <label class="kl-label">
            {{ i18n().t("schedules.name") }}
            <input #name class="kl-input" required [placeholder]="i18n().t('schedules.namePlaceholder')" [value]="f.name" (input)="set('name', name.value)" />
          </label>
          <label class="kl-label">
            {{ i18n().t("schedules.when") }}
            <select #cron class="kl-select" (change)="set('cron', cron.value)">
              @for (preset of PRESETS; track preset) {
                <option [value]="preset" [selected]="f.cron === preset">{{ i18n().describeCron(preset) }}</option>
              }
              <option value="custom" [selected]="f.cron === 'custom'">{{ i18n().t("schedules.custom") }}</option>
            </select>
          </label>
          @if (f.cron === "custom") {
            <label class="kl-label">
              {{ i18n().t("schedules.cron") }}
              <input #custom class="kl-input kl-code" placeholder="30 7 * * 1-5" [value]="f.custom" (input)="set('custom', custom.value)" />
            </label>
          }
          @if (agents.length > 0) {
            <label class="kl-label">
              {{ i18n().t("schedules.runAs") }}
              <select #agent class="kl-select" (change)="set('agent', agent.value)">
                <option value="" [selected]="!f.agent">{{ i18n().t("schedules.mainAgent") }}</option>
                @for (option of agents; track option.name) {
                  <option [value]="option.name" [selected]="f.agent === option.name">{{ option.name }}</option>
                }
              </select>
            </label>
          }
          <label class="kl-label">
            {{ i18n().t("schedules.prompt") }}
            <textarea
              #prompt
              class="kl-textarea"
              rows="3"
              required
              [placeholder]="i18n().t('schedules.promptPlaceholder')"
              [value]="f.prompt"
              (input)="set('prompt', prompt.value)"
            ></textarea>
          </label>
          <div class="kl-schedule__actions">
            <button type="submit" class="kl-btn kl-btn--primary kl-btn--sm" [disabled]="saving()">{{ i18n().t("schedules.create") }}</button>
            <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" (click)="creating.set(false)">{{ i18n().t("common.cancel") }}</button>
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
  protected readonly i18n = injectI18n();
  protected readonly creating = signal(false);
  protected readonly form = signal(EMPTY_FORM);
  protected readonly saving = signal(false);
  protected readonly PRESETS = PRESETS;
  protected readonly statusTone = statusTone;
  protected readonly statusLabels = statusLabels;

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
