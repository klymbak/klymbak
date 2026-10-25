import { ChangeDetectionStrategy, Component, computed, input, signal } from "@angular/core";
import type { SourcesBlock } from "@klymbak/protocol";
import { safeUrl } from "@klymbak/client";
import { injectI18n } from "../../context.ts";
import { KlIcon } from "../KlIcon.ts";

const PAGE = 4;
/** Excerpts longer than this show three lines until opened. */
const LONG_EXCERPT = 300;

@Component({
  selector: "kl-source-list",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let b = block();
    <section class="kl-sources">
      <div class="kl-sources__bar">
        <svg klIcon name="file" [size]="14" />
        <span class="kl-sources__title">{{ b.title ?? i18n().t("sources.title") }}</span>
        @if (b.items.length > 1) {
          <span class="kl-sources__count kl-num">{{ i18n().t("sources.count", { count: b.items.length }) }}</span>
        }
      </div>
      <ol class="kl-sources__list">
        @for (row of rows(); track $index + ":" + (row.item.url ?? row.item.title); let i = $index) {
          <li class="kl-sources__item">
            <span class="kl-sources__n kl-num">{{ i + 1 }}</span>
            @if (row.url) {
              <a class="kl-sources__name" [href]="row.url" target="_blank" rel="noopener noreferrer" [attr.aria-label]="i18n().t('sources.open', { title: row.item.title })"
                >{{ row.item.title }}<svg klIcon name="external" [size]="12"
              /></a>
            } @else {
              <span class="kl-sources__name">{{ row.item.title }}</span>
            }
            @if (row.where) {
              <span class="kl-sources__where">{{ row.where }}</span>
            }
            @if (row.item.excerpt) {
              <p class="kl-sources__excerpt" [class.kl-sources__excerpt--clamped]="row.long && !open().has(i)">{{ row.item.excerpt }}</p>
            }
            @if (row.long) {
              <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm kl-sources__toggle" [attr.aria-expanded]="open().has(i)" (click)="toggle(i)">
                {{ i18n().t(open().has(i) ? "sources.collapse" : "sources.expand") }}
              </button>
            }
          </li>
        }
      </ol>
      @if (hidden() > 0 || (expanded() && b.items.length > PAGE)) {
        <div class="kl-sources__foot">
          <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" (click)="expanded.set(hidden() > 0)">
            {{ hidden() > 0 ? i18n().t("common.showMore", { count: hidden() }) : i18n().t("common.showFewer") }}
          </button>
        </div>
      }
    </section>
  `,
})
export class SourceList {
  readonly block = input.required<SourcesBlock>();
  protected readonly i18n = injectI18n();
  protected readonly expanded = signal(false);
  protected readonly open = signal<ReadonlySet<number>>(new Set());
  protected readonly PAGE = PAGE;

  protected readonly visible = computed(() => (this.expanded() ? this.block().items : this.block().items.slice(0, PAGE)));
  protected readonly hidden = computed(() => this.block().items.length - this.visible().length);
  protected readonly rows = computed(() =>
    this.visible().map((item) => ({
      item,
      url: safeUrl(item.url),
      where: [item.source, item.location].filter(Boolean).join(" · "),
      long: (item.excerpt?.length ?? 0) > LONG_EXCERPT,
    })),
  );

  protected toggle(index: number) {
    this.open.update((current) => {
      const next = new Set(current);
      if (!next.delete(index)) next.add(index);
      return next;
    });
  }
}
