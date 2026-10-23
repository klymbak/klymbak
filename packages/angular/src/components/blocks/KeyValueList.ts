import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import type { KeyValueBlock } from "@klymbak/protocol";
import { toneClass } from "@klymbak/client";
import { injectI18n } from "../../context.ts";
import { displayText } from "../../util.ts";

@Component({
  selector: "kl-key-value-list",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let b = block();
    <section class="kl-kv">
      @if (b.title) {
        <h4 class="kl-kv__title">{{ b.title }}</h4>
      }
      <dl class="kl-kv__list">
        @for (item of b.items; track item.label) {
          <div class="kl-kv__row">
            <dt>{{ item.label }}</dt>
            <dd>
              @if (item.format === "badge") {
                <span class="kl-pill {{ toneClass(item.tone) }}">{{ displayText(item.value) }}</span>
              } @else if (item.format === "code") {
                <span class="kl-code">{{ displayText(item.value) }}</span>
              } @else {
                <span [class]="item.tone ? 'kl-kv__toned ' + toneClass(item.tone) : ''">{{ i18n().formatValue(item.value, item.format, item.currency) }}</span>
              }
            </dd>
          </div>
        }
      </dl>
    </section>
  `,
})
export class KeyValueList {
  readonly block = input.required<KeyValueBlock>();
  protected readonly displayText = displayText;
  protected readonly i18n = injectI18n();
  protected readonly toneClass = toneClass;
}
