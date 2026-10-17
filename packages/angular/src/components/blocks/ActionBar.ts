import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import type { ActionsBlock, UiAction } from "@klymbak/protocol";
import { CHAT_ACTIONS } from "../../context.ts";
import { KlIcon } from "../KlIcon.ts";

@Component({
  selector: "kl-action-bar",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let b = block();
    <div class="kl-actions">
      @if (b.title) {
        <span class="kl-actions__title">{{ b.title }}</span>
      }
      @for (action of b.actions; track action.label) {
        @if (action.kind === "link" && action.href) {
          <a class="kl-btn kl-btn--sm" [href]="action.href" target="_blank" rel="noopener noreferrer">{{ action.label }} <svg klIcon name="external" [size]="12" /></a>
        } @else {
          <button type="button" [class]="action.tone === 'danger' ? 'kl-btn kl-btn--sm kl-btn--danger' : 'kl-btn kl-btn--sm'" (click)="run(action)">{{ action.label }}</button>
        }
      }
    </div>
  `,
})
export class ActionBar {
  readonly block = input.required<ActionsBlock>();
  private readonly actions = inject(CHAT_ACTIONS);

  protected run(action: UiAction) {
    if (action.kind === "link" && action.href) return;
    if (action.prompt && action.kind !== "event") this.actions.sendPrompt(action.prompt);
    else this.actions.emitAction(action);
  }
}
