import { ChangeDetectionStrategy, Component, booleanAttribute, input, signal } from "@angular/core";
import { injectI18n } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";

@Component({
  selector: "kl-thinking-block",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @if (text().trim() || redacted() || active()) {
      <div class="kl-think">
        <button type="button" class="kl-think__toggle" [attr.aria-expanded]="open()" (click)="open.set(!open())">
          <svg klIcon name="brain" [size]="14" />
          <span>{{ i18n().t(active() ? "thinking.active" : "thinking.done") }}</span>
          @if (active()) {
            <span class="kl-think__dots" aria-hidden="true"><i></i><i></i><i></i></span>
          }
          <svg klIcon [name]="open() ? 'chevronDown' : 'chevron'" [size]="12" />
        </button>
        @if (open() || (active() && text())) {
          <p class="kl-think__text" [class.kl-think__text--live]="active() && !open()">
            {{ redacted() ? i18n().t("thinking.redacted") : text().trim() }}
          </p>
        }
      </div>
    }
  `,
})
export class ThinkingBlock {
  readonly text = input.required<string>();
  readonly active = input(false, { transform: booleanAttribute });
  readonly redacted = input(false, { transform: booleanAttribute });
  protected readonly i18n = injectI18n();
  protected readonly open = signal(false);
}
