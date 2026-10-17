import { ChangeDetectionStrategy, Component, booleanAttribute, input, signal } from "@angular/core";
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
          <span>{{ active() ? "Thinking" : "Reasoning" }}</span>
          @if (active()) {
            <span class="kl-think__dots" aria-hidden="true"><i></i><i></i><i></i></span>
          }
          <svg klIcon [name]="open() ? 'chevronDown' : 'chevron'" [size]="12" />
        </button>
        @if (open() || (active() && text())) {
          <p class="kl-think__text" [class.kl-think__text--live]="active() && !open()">
            {{ redacted() ? "The model's reasoning is hidden by the provider." : text().trim() }}
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
  protected readonly open = signal(false);
}
