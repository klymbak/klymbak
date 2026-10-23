import { ChangeDetectionStrategy, Component, computed, input, signal } from "@angular/core";
import { mediaKind, type MediaBlock, type MediaItem } from "@klymbak/protocol";
import { mediaMeta, mediaName, mediaType, safeUrl } from "@klymbak/client";
import { injectI18n } from "../../context.ts";
import { KlIcon } from "../KlIcon.ts";

const PAGE = 12;

@Component({
  selector: "kl-media-gallery",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let b = block();
    @let total = b.totalItems ?? b.items.length;
    <div class="kl-media" [class.kl-media--single]="b.items.length === 1">
      @if (b.title || b.items.length > 1) {
        <div class="kl-media__bar">
          <span class="kl-media__title">{{ b.title }}</span>
          <span class="kl-media__count kl-num">{{ i18n().t("media.files", { count: total }) }}</span>
        </div>
      }
      <ul class="kl-media__grid">
        @for (item of visible(); track $index + ":" + item.url) {
          @let tile = tileOf(item);
          <li>
            <figure class="kl-media__item">
              @if (tile.kind === "video") {
                <div class="kl-media__preview">
                  <video [src]="tile.url" controls muted playsinline preload="metadata" (error)="fail(tile.url)"></video>
                </div>
              } @else if (tile.url) {
                <a class="kl-media__preview" [href]="tile.url" target="_blank" rel="noopener noreferrer" [attr.aria-label]="i18n().t('media.open', { name: tile.name })">
                  @if (tile.kind === "image") {
                    <img [src]="tile.url" [alt]="item.alt ?? ''" loading="lazy" decoding="async" (error)="fail(tile.url)" />
                  } @else {
                    <span class="kl-media__file"><svg klIcon name="file" [size]="28" />{{ tile.type ?? i18n().t("media.file") }}</span>
                  }
                </a>
              } @else {
                <div class="kl-media__preview">
                  <span class="kl-media__file"><svg klIcon name="file" [size]="28" />{{ tile.type ?? i18n().t("media.file") }}</span>
                </div>
              }
              <figcaption>
                <span class="kl-media__name" [title]="tile.name">{{ tile.name }}</span>
                @if (tile.meta) {
                  <span class="kl-media__meta kl-num">{{ tile.meta }}</span>
                }
                @if (item.caption) {
                  <span class="kl-media__caption" [title]="item.caption">{{ item.caption }}</span>
                }
              </figcaption>
            </figure>
          </li>
        }
      </ul>
      @if (hidden() > 0 || expanded() || b.caption || total > b.items.length) {
        <div class="kl-media__foot">
          @if (hidden() > 0) {
            <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" (click)="expanded.set(true)">{{ i18n().t("common.showMore", { count: hidden() }) }}</button>
          } @else if (expanded() && b.items.length > PAGE) {
            <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" (click)="expanded.set(false)">{{ i18n().t("common.showFewer") }}</button>
          }
          @if (total > b.items.length) {
            <span class="kl-faint">{{ i18n().t("common.showingOf", { shown: b.items.length, total: total }) }}</span>
          }
          @if (b.caption) {
            <span class="kl-faint kl-media__foot-caption">{{ b.caption }}</span>
          }
        </div>
      }
    </div>
  `,
})
export class MediaGallery {
  readonly block = input.required<MediaBlock>();
  protected readonly i18n = injectI18n();
  protected readonly expanded = signal(false);
  // A file whose preview fails to load (deleted, or a path this page can't reach) shows as a file tile.
  private readonly broken = signal<ReadonlySet<string>>(new Set());
  protected readonly PAGE = PAGE;

  protected readonly visible = computed(() => (this.expanded() ? this.block().items : this.block().items.slice(0, PAGE)));
  protected readonly hidden = computed(() => this.block().items.length - this.visible().length);

  protected tileOf(item: MediaItem) {
    const url = safeUrl(item.url);
    const kind = url && !this.broken().has(url) ? mediaKind(item) : "file";
    return { url, kind, name: mediaName(item), meta: mediaMeta(item), type: mediaType(item) };
  }

  protected fail(url: string | undefined) {
    if (url) this.broken.update((current) => new Set(current).add(url));
  }
}
