import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, afterRenderEffect, computed, inject, input, signal, viewChild } from "@angular/core";
import type { ModelInfo, ThinkingLevel } from "@klymbak/protocol";
import { formatContext, selectCurrentModel, selectModels } from "@klymbak/client";
import { injectAgentState, injectI18n, injectStoreRef } from "../context.ts";
import { KlIcon } from "./KlIcon.ts";

@Component({
  selector: "kl-model-picker",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let s = state();
    @let model = current();
    <div #root class="kl-models" (keydown.escape)="open.set(false)">
      <button type="button" class="kl-models__button" [attr.aria-expanded]="open()" aria-haspopup="listbox" (click)="toggle()">
        <span class="kl-models__name">{{ model?.name ?? i18n().t(models().length ? "models.choose" : "models.none") }}</span>
        @if (model) {
          <span class="kl-models__provider">{{ model.providerName }}</span>
        }
        @if (model?.reasoning && s.thinkingLevel !== "off") {
          <span class="kl-pill kl-tone-accent">{{ i18n().t("models.thinkingPill", { level: levelLabel(s.thinkingLevel) }) }}</span>
        }
        <svg klIcon name="chevronDown" [size]="12" />
      </button>
      @if (open()) {
        <div class="kl-models__panel kl-models__panel--{{ placement() }}" role="listbox">
          <input
            #search
            class="kl-input"
            type="search"
            [placeholder]="i18n().t('models.search')"
            [attr.aria-label]="i18n().t('models.search')"
            [value]="query()"
            (input)="query.set(search.value)"
          />
          <div class="kl-models__groups kl-scroll">
            @for (group of groups(); track group.provider) {
              <div class="kl-models__group">
                <span class="kl-models__group-name">{{ group.name }}</span>
                @for (option of group.models; track option.id) {
                  <button
                    type="button"
                    role="option"
                    class="kl-models__option"
                    [class.kl-models__option--active]="isCurrent(option)"
                    [attr.aria-selected]="isCurrent(option)"
                    (click)="choose(option)"
                  >
                    <span class="kl-models__option-name">{{ option.name }}</span>
                    <span class="kl-models__badges">
                      @if (option.local) {
                        <span class="kl-pill kl-tone-success">{{ i18n().t("models.local") }}</span>
                      }
                      @if (option.reasoning) {
                        <span class="kl-pill kl-tone-accent">{{ i18n().t("models.reasoning") }}</span>
                      }
                      @if (option.input.includes("image")) {
                        <span class="kl-pill">{{ i18n().t("models.vision") }}</span>
                      }
                      <span class="kl-faint kl-num">{{ formatContext(option.contextWindow) }}</span>
                    </span>
                  </button>
                }
              </div>
            }
            @if (!groups().length) {
              <p class="kl-models__empty">{{ i18n().t(models().length ? "models.noMatch" : "models.noProviders") }}</p>
            }
          </div>
          @if (levels().length > 1) {
            <div class="kl-models__thinking">
              <span>{{ i18n().t("models.thinking") }}</span>
              <div class="kl-segmented" role="radiogroup" [attr.aria-label]="i18n().t('models.thinkingLevel')">
                @for (level of levels(); track level) {
                  <button
                    type="button"
                    role="radio"
                    [attr.aria-checked]="s.thinkingLevel === level"
                    [class.active]="s.thinkingLevel === level"
                    (click)="store().setThinkingLevel(level)"
                  >{{ levelLabel(level) }}</button>
                }
              </div>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class ModelPicker {
  readonly placement = input<"up" | "down">("up");
  protected readonly store = injectStoreRef();
  protected readonly state = injectAgentState();
  protected readonly i18n = injectI18n();
  protected readonly open = signal(false);
  protected readonly query = signal("");
  protected readonly formatContext = formatContext;
  private readonly root = viewChild.required<ElementRef<HTMLElement>>("root");
  private readonly search = viewChild<ElementRef<HTMLInputElement>>("search");

  protected readonly models = computed(() => selectModels(this.state()));
  protected readonly current = computed(() => selectCurrentModel(this.state()));
  protected readonly levels = computed((): ThinkingLevel[] => {
    const current = this.current();
    return current?.reasoning ? current.thinkingLevels.filter((l) => l !== "minimal") : [];
  });
  protected readonly groups = computed(() => {
    const q = this.query().trim().toLowerCase();
    const groups = new Map<string, { provider: string; name: string; models: ModelInfo[] }>();
    for (const model of this.models()) {
      if (q && !`${model.name} ${model.id} ${model.providerName}`.toLowerCase().includes(q)) continue;
      const group = groups.get(model.provider) ?? { provider: model.provider, name: model.providerName, models: [] };
      group.models.push(model);
      groups.set(model.provider, group);
    }
    return [...groups.values()];
  });

  constructor() {
    afterRenderEffect(() => {
      if (this.open()) this.search()?.nativeElement.focus();
    });
    // Close on a click outside.
    const document = inject(DOCUMENT);
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const onOutside = (event: MouseEvent) => {
        if (this.open() && !this.root().nativeElement.contains(event.target as Node)) this.open.set(false);
      };
      document.addEventListener("mousedown", onOutside);
      destroyRef.onDestroy(() => document.removeEventListener("mousedown", onOutside));
    });
  }

  protected levelLabel(level: ThinkingLevel) {
    return this.i18n().t(`models.level.${level}`);
  }

  protected isCurrent(model: ModelInfo) {
    const chosen = this.state().model;
    return chosen?.provider === model.provider && chosen?.id === model.id;
  }

  protected toggle() {
    if (!this.open()) this.query.set("");
    this.open.set(!this.open());
  }

  protected choose(model: ModelInfo) {
    this.store().setModel({ provider: model.provider, id: model.id });
    this.open.set(false);
  }
}
