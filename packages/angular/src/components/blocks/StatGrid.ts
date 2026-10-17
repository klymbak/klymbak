import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import type { StatItem, StatsBlock } from "@klymbak/protocol";
import { formatValue, toneClass } from "@klymbak/client";
import { KlIcon } from "../KlIcon.ts";

function deltaTone(item: StatItem) {
  if (item.delta === undefined || item.delta === 0) return "neutral";
  const good = item.invertDelta ? item.delta < 0 : item.delta > 0;
  return good ? "success" : "danger";
}

function deltaText(delta: number) {
  return `${Math.abs(delta * 100).toFixed(Math.abs(delta) < 0.1 ? 1 : 0)}%`;
}

@Component({
  selector: "kl-stat-grid",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let b = block();
    <section class="kl-stats">
      @if (b.title) {
        <h4 class="kl-stats__title">{{ b.title }}</h4>
      }
      <div class="kl-stats__grid">
        @for (item of b.items; track item.label) {
          <div class="kl-stat" [class]="item.tone ? toneClass(item.tone) : ''">
            <span class="kl-stat__label">{{ item.label }}</span>
            <span class="kl-stat__value kl-num">{{ value(item) }}</span>
            @if (item.delta !== undefined) {
              <span class="kl-stat__delta kl-num {{ toneClass(deltaTone(item)) }}">
                <svg klIcon [name]="item.delta >= 0 ? 'arrowUp' : 'arrowDown'" [size]="12" /> {{ deltaText(item.delta) }}
                @if (item.deltaLabel) {
                  <span class="kl-stat__delta-label">{{ item.deltaLabel }}</span>
                }
              </span>
            }
          </div>
        }
      </div>
    </section>
  `,
})
export class StatGrid {
  readonly block = input.required<StatsBlock>();
  protected readonly toneClass = toneClass;
  protected readonly deltaTone = deltaTone;
  protected readonly deltaText = deltaText;

  protected value(item: StatItem) {
    return typeof item.value === "number" ? formatValue(item.value, item.format, item.currency) : item.value;
  }
}
