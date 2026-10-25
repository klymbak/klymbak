import { Component, input, output, signal } from "@angular/core";
import type { ApprovalDecision, ApprovalView } from "@klymbak/protocol";
import { injectI18n, injectOptionalStoreRef } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";

const riskTone = { low: "info", medium: "warning", high: "danger" } as const;

// Default change detection: the approval is updated in place when someone decides.
@Component({
  selector: "kl-approval-prompt",
  imports: [KlIcon],
  host: { style: "display: contents" },
  template: `
    @let a = approval();
    <div class="kl-approval kl-approval--{{ a.status }} kl-tone-{{ riskTone[a.risk ?? 'medium'] }}">
      @if (a.status === "pending") {
        <div class="kl-approval__head">
          <svg klIcon name="shield" [size]="15" />
          <span>{{ i18n().t("approval.needed") }}</span>
          @if (a.risk) {
            <span class="kl-pill kl-tone-{{ riskTone[a.risk] }}">{{ i18n().t(riskLabels[a.risk]) }}</span>
          }
        </div>
        <p class="kl-approval__title">{{ a.title }}</p>
        @if (a.description) {
          <p class="kl-approval__desc">{{ a.description }}</p>
        }
        @if (a.fields?.length) {
          <div class="kl-approval__fields">
            @for (field of a.fields; track field.name) {
              <label class="kl-label">
                {{ field.label }}
                @if (field.multiline) {
                  <textarea
                    #box
                    class="kl-textarea"
                    rows="4"
                    [value]="drafts()[field.name] ?? field.value"
                    [disabled]="busy()"
                    (input)="draft(field.name, box.value)"
                  ></textarea>
                } @else {
                  <input
                    #line
                    class="kl-input"
                    type="text"
                    [value]="drafts()[field.name] ?? field.value"
                    [disabled]="busy()"
                    (input)="draft(field.name, line.value)"
                  />
                }
              </label>
            }
          </div>
        }
        @if (denying()) {
          <label class="kl-label kl-approval__reason">
            {{ i18n().t("approval.reasonLabel") }}
            <input
              #field
              class="kl-input"
              type="text"
              [placeholder]="i18n().t('approval.reasonPlaceholder')"
              [value]="reason()"
              (input)="reason.set(field.value)"
              (keydown.enter)="respond(false)"
            />
          </label>
        }
        <div class="kl-approval__buttons">
          <button type="button" class="kl-btn kl-btn--primary" [disabled]="busy()" (click)="respond(true)">
            <svg klIcon name="check" [size]="14" /> {{ i18n().t("approval.approve") }}
          </button>
          <button type="button" class="kl-btn" [disabled]="busy()" (click)="respond(false)">
            <svg klIcon name="x" [size]="14" /> {{ i18n().t(denying() ? "approval.confirmDeny" : "approval.deny") }}
          </button>
          @if (a.rememberable && !denying()) {
            <label class="kl-approval__remember">
              <input #box type="checkbox" [checked]="remember()" (change)="remember.set(box.checked)" />
              {{ i18n().t("approval.remember") }}
            </label>
          }
        </div>
      } @else {
        <div class="kl-approval__decided">
          <span class="kl-stamp kl-stamp--{{ a.status }}">{{ i18n().t(statusLabels[a.status]) }}</span>
          <div class="kl-approval__summary">
            <span class="kl-approval__title">{{ a.title }}</span>
            <span class="kl-faint">{{ decision() }}</span>
          </div>
        </div>
      }
    </div>
  `,
})
export class ApprovalPrompt {
  readonly approval = input.required<ApprovalView>();
  /** The conversation the approval belongs to, when it isn't the open one (the inbox's items). */
  readonly sessionId = input<string>();
  readonly decide = output<ApprovalDecision>();
  private readonly store = injectOptionalStoreRef();
  protected readonly i18n = injectI18n();
  protected readonly riskLabels = { low: "approval.risk.low", medium: "approval.risk.medium", high: "approval.risk.high" } as const;
  protected readonly statusLabels = {
    pending: "approval.status.pending",
    approved: "approval.status.approved",
    denied: "approval.status.denied",
    expired: "approval.status.expired",
  } as const;
  protected readonly remember = signal(false);
  protected readonly reason = signal("");
  protected readonly denying = signal(false);
  protected readonly busy = signal(false);
  /** What the person typed into the fields, by name. */
  protected readonly drafts = signal<Partial<Record<string, string>>>({});
  protected readonly riskTone = riskTone;

  /** Who decided, why, or that nobody did. */
  protected decision() {
    const { decidedBy, edited, reason, status } = this.approval();
    const i18n = this.i18n();
    return [
      decidedBy ? i18n.t("approval.decidedBy", { name: decidedBy }) : "",
      edited ? ` · ${i18n.t("approval.edited")}` : "",
      reason ? ` · ${i18n.t("approval.reason", { reason })}` : "",
      status === "expired" ? i18n.t("approval.expiredNote") : "",
    ].join("");
  }

  protected async respond(approved: boolean) {
    if (!approved && !this.denying()) {
      this.denying.set(true);
      return;
    }
    this.busy.set(true);
    const edits: Record<string, string> = {};
    for (const field of this.approval().fields ?? []) {
      const draft = this.drafts()[field.name];
      if (draft !== undefined && draft !== field.value) edits[field.name] = draft;
    }
    const decision: ApprovalDecision = {
      approved,
      reason: this.reason().trim() || undefined,
      remember: approved && this.remember(),
      ...(approved && Object.keys(edits).length ? { edits } : {}),
    };
    this.decide.emit(decision);
    try {
      await this.store?.().decide(this.approval().id, decision, this.sessionId());
    } finally {
      this.busy.set(false);
    }
  }

  protected draft(name: string, value: string) {
    this.drafts.update((current) => ({ ...current, [name]: value }));
  }
}
