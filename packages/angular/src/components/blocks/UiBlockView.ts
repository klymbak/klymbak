import { NgComponentOutlet } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, input, reflectComponentType } from "@angular/core";
import type { UiBlock } from "@klymbak/protocol";
import { toneClass } from "@klymbak/client";
import { RENDERERS } from "../../context.ts";
import { KlIcon } from "../KlIcon.ts";
import { MarkdownContent } from "../MarkdownContent.ts";
import { ActionBar } from "./ActionBar.ts";
import { ChartView } from "./ChartView.ts";
import { DataTable } from "./DataTable.ts";
import { KeyValueList } from "./KeyValueList.ts";
import { MediaGallery } from "./MediaGallery.ts";
import { StatGrid } from "./StatGrid.ts";

@Component({
  selector: "kl-ui-block-view",
  imports: [ActionBar, ChartView, DataTable, KeyValueList, KlIcon, MarkdownContent, MediaGallery, NgComponentOutlet, StatGrid],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let b = block();
    @switch (b.type) {
      @case ("table") {
        <kl-data-table [block]="b" />
      }
      @case ("stats") {
        <kl-stat-grid [block]="b" />
      }
      @case ("chart") {
        <kl-chart-view [block]="b" />
      }
      @case ("keyvalue") {
        <kl-key-value-list [block]="b" />
      }
      @case ("media") {
        <kl-media-gallery [block]="b" />
      }
      @case ("actions") {
        <kl-action-bar [block]="b" />
      }
      @case ("markdown") {
        <div class="kl-block-md"><kl-markdown-content [source]="b.text" /></div>
      }
      @case ("alert") {
        <div class="kl-alert {{ toneClass(b.tone) }}" role="status">
          <svg klIcon [name]="b.tone === 'success' ? 'check' : b.tone === 'danger' || b.tone === 'warning' ? 'alert' : 'info'" [size]="16" />
          <div>
            @if (b.title) {
              <strong>{{ b.title }}</strong>
            }
            <p>{{ b.text }}</p>
          </div>
        </div>
      }
      @default {
        @if (custom(); as custom) {
          <ng-container *ngComponentOutlet="custom.component; inputs: custom.inputs" />
        } @else {
          <pre class="kl-block-raw">{{ json(b) }}</pre>
        }
      }
    }
  `,
})
export class UiBlockView {
  readonly block = input.required<UiBlock>();
  private readonly renderers = inject(RENDERERS);
  protected readonly toneClass = toneClass;

  /** A custom block's component, with the block's props that match its inputs. */
  protected readonly custom = computed(() => {
    const block = this.block();
    const component = block.type === "custom" ? this.renderers().blocks?.[block.component] : undefined;
    if (!component || block.type !== "custom") return undefined;
    const inputs = new Set(reflectComponentType(component)?.inputs.map((input) => input.templateName));
    return { component, inputs: Object.fromEntries(Object.entries(block.props ?? {}).filter(([key]) => inputs.has(key))) };
  });

  protected json(value: unknown) {
    return JSON.stringify(value, null, 2);
  }
}
