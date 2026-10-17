import { Component, input, output, signal } from "@angular/core";
import type { ApprovalDecision, ApprovalView } from "@klymbak/protocol";
import { injectOptionalStoreRef } from "../context.ts";
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
          <span>Needs your approval</span>
          @if (a.risk) {
            <span class="kl-pill kl-tone-{{ riskTone[a.risk] }}">{{ a.risk }} risk</span>
          }
        </div>
        <p class="kl-approval__title">{{ a.title }}</p>
        @if (a.description) {
          <p class="kl-approval__desc">{{ a.description }}</p>
        }
        @if (denying()) {
          <label class="kl-label kl-approval__reason">
            Why not? (optional, the agent will read this)
            <input
              #field
              class="kl-input"
              type="text"
              placeholder="e.g. Offer a replacement instead"
              [value]="reason()"
              (input)="reason.set(field.value)"
              (keydown.enter)="respond(false)"
            />
          </label>
        }
        <div class="kl-approval__buttons">
          <button type="button" class="kl-btn kl-btn--primary" [disabled]="busy()" (click)="respond(true)"><svg klIcon name="check" [size]="14" /> Approve</button>
          <button type="button" class="kl-btn" [disabled]="busy()" (click)="respond(false)">
            <svg klIcon name="x" [size]="14" /> {{ denying() ? "Confirm deny" : "Deny" }}
          </button>
          @if (a.rememberable && !denying()) {
            <label class="kl-approval__remember">
              <input #box type="checkbox" [checked]="remember()" (change)="remember.set(box.checked)" />
              Don't ask again in this chat
            </label>
          }
        </div>
      } @else {
        <div class="kl-approval__decided">
          <span class="kl-stamp kl-stamp--{{ a.status }}">{{ a.status }}</span>
          <div class="kl-approval__summary">
            <span class="kl-approval__title">{{ a.title }}</span>
            <span class="kl-faint">{{ a.decidedBy ? "by " + a.decidedBy : "" }}{{ a.reason ? " · “" + a.reason + "”" : "" }}{{ a.status === "expired" ? "Nobody decided in time" : "" }}</span>
          </div>
        </div>
      }
    </div>
  `,
})
export class ApprovalPrompt {
  readonly approval = input.required<ApprovalView>();
  readonly decide = output<ApprovalDecision>();
  private readonly store = injectOptionalStoreRef();
  protected readonly remember = signal(false);
  protected readonly reason = signal("");
  protected readonly denying = signal(false);
  protected readonly busy = signal(false);
  protected readonly riskTone = riskTone;

  protected async respond(approved: boolean) {
    if (!approved && !this.denying()) {
      this.denying.set(true);
      return;
    }
    this.busy.set(true);
    const decision = { approved, reason: this.reason().trim() || undefined, remember: approved && this.remember() };
    this.decide.emit(decision);
    try {
      await this.store?.().decide(this.approval().id, decision);
    } finally {
      this.busy.set(false);
    }
  }
}
