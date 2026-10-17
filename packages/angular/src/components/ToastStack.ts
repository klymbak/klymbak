import { ChangeDetectionStrategy, Component, output } from "@angular/core";
import type { Toast } from "@klymbak/client";
import { injectAgentState, injectStoreRef } from "../context.ts";
import { animateWith } from "../transition.ts";
import { KlIcon } from "./KlIcon.ts";

const icons = { success: "check", danger: "alert", warning: "bell", info: "info" } as const;

/** The store's notifications. A dismissed toast stays in place until it has animated out. */
@Component({
  selector: "kl-toast-stack",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    <div class="kl-toasts" aria-live="polite">
      @for (toast of state().toasts; track toast.id) {
        <div class="kl-toast kl-tone-{{ toast.tone }}" role="status" (animate.enter)="enter($event)" (animate.leave)="leave($event)">
          <svg klIcon class="kl-toast__icon" [name]="icons[toast.tone]" [size]="16" />
          <div class="kl-toast__body">
            <strong>{{ toast.title }}</strong>
            @if (toast.body) {
              <p>{{ toast.body }}</p>
            }
            @if (toast.sessionId) {
              <button type="button" class="kl-btn kl-btn--sm" (click)="open(toast)">Open</button>
            }
          </div>
          <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" aria-label="Dismiss" (click)="store().dismissToast(toast.id)">
            <svg klIcon name="close" [size]="12" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastStack {
  readonly openSession = output<string>();
  protected readonly store = injectStoreRef();
  protected readonly state = injectAgentState();
  protected readonly icons = icons;
  protected readonly enter = animateWith("kl-toast", "enter");
  protected readonly leave = animateWith("kl-toast", "leave");

  protected open(toast: Toast) {
    if (!toast.sessionId) return;
    void this.store().openSession(toast.sessionId);
    this.openSession.emit(toast.sessionId);
    this.store().dismissToast(toast.id);
  }
}
