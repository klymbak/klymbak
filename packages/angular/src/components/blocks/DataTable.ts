import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from "@angular/core";
import type { TableBlock, TableColumn, UiAction } from "@klymbak/protocol";
import { fillTemplate, toneClass } from "@klymbak/client";
import { CHAT_ACTIONS, injectI18n } from "../../context.ts";
import { displayText } from "../../util.ts";
import { KlIcon } from "../KlIcon.ts";

const PAGE = 10;

const numeric = (column: TableColumn) => ["number", "integer", "currency", "percent"].includes(column.format ?? "");
const align = (column: TableColumn) => column.align ?? (numeric(column) ? "right" : "left");

type Row = Record<string, unknown>;

@Component({
  selector: "kl-data-table",
  imports: [KlIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let b = block();
    @let total = b.totalRows ?? b.rows.length;
    @let hasRowActions = !!b.rowActions?.length;
    <div class="kl-table">
      @if (b.title || b.rows.length > 0) {
        <div class="kl-table__bar">
          <span class="kl-table__title">{{ b.title }}</span>
          <span class="kl-table__count kl-num">{{ i18n().t("table.rows", { count: total }) }}</span>
          <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" [title]="i18n().t('table.copyCsv')" (click)="copyCsv()">
            <svg klIcon [name]="copied() ? 'check' : 'copy'" [size]="14" />{{ i18n().t(copied() ? "table.copied" : "table.csv") }}
          </button>
        </div>
      }
      <div class="kl-table__scroll kl-scroll">
        <table>
          <thead>
            <tr>
              @for (column of b.columns; track column.key) {
                <th [style.text-align]="align(column)" [attr.aria-sort]="sortKey() === column.key ? (sortDir() === 1 ? 'ascending' : 'descending') : 'none'">
                  <button type="button" class="kl-table__sort" (click)="sortBy(column)">
                    {{ column.label }}
                    @if (sortKey() === column.key) {
                      <svg klIcon [name]="sortDir() === 1 ? 'arrowUp' : 'arrowDown'" [size]="12" />
                    }
                  </button>
                </th>
              }
              @if (hasRowActions) {
                <th class="kl-table__actions-head"><span class="kl-sr-only">{{ i18n().t("table.actions") }}</span></th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of visible(); track rowKey(row, $index)) {
              <tr>
                @for (column of b.columns; track column.key) {
                  @let value = row[column.key];
                  <td [style.text-align]="align(column)" [class.kl-num]="numeric(column)">
                    @if (column.format === "badge" && value !== null && value !== undefined) {
                      <span class="kl-pill {{ toneClass(column.tones?.[displayText(value)]) }}">{{ displayText(value) }}</span>
                    } @else if (column.format === "code") {
                      <span class="kl-code">{{ column.key === "id" && isNumber(value) ? "#" + value : displayText(value) }}</span>
                    } @else if (column.format === "email") {
                      <span class="kl-table__email">{{ displayText(value) }}</span>
                    } @else {
                      <ng-container>{{ i18n().formatValue(value, column.format, column.currency) }}</ng-container>
                    }
                  </td>
                }
                @if (hasRowActions) {
                  <td class="kl-table__row-actions">
                    @for (action of b.rowActions; track action.label) {
                      <button type="button" class="kl-btn kl-btn--sm" (click)="runRowAction(action, row)">{{ action.label }}</button>
                    }
                  </td>
                }
              </tr>
            }
            @if (!b.rows.length) {
              <tr>
                <td [attr.colspan]="b.columns.length + (hasRowActions ? 1 : 0)" class="kl-table__empty">{{ i18n().t("table.empty") }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (hidden() > 0 || expanded() || b.caption || total > b.rows.length) {
        <div class="kl-table__foot">
          @if (hidden() > 0) {
            <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" (click)="expanded.set(true)">{{ i18n().t("common.showMore", { count: hidden() }) }}</button>
          } @else if (expanded() && b.rows.length > PAGE) {
            <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" (click)="expanded.set(false)">{{ i18n().t("common.showFewer") }}</button>
          }
          @if (total > b.rows.length) {
            <span class="kl-faint">{{ i18n().t("common.showingOf", { shown: b.rows.length, total: total }) }}</span>
          }
          @if (b.caption) {
            <span class="kl-faint kl-table__caption">{{ b.caption }}</span>
          }
        </div>
      }
    </div>
  `,
})
export class DataTable {
  readonly block = input.required<TableBlock>();
  private readonly actions = inject(CHAT_ACTIONS);
  protected readonly expanded = signal(false);
  protected readonly sortKey = signal<string | null>(null);
  protected readonly sortDir = signal<1 | -1>(1);
  protected readonly copied = signal(false);

  protected readonly PAGE = PAGE;
  protected readonly align = align;
  protected readonly numeric = numeric;
  protected readonly displayText = displayText;
  protected readonly i18n = injectI18n();
  protected readonly toneClass = toneClass;

  protected readonly sorted = computed(() => {
    const rows = [...this.block().rows];
    const key = this.sortKey();
    const dir = this.sortDir();
    if (!key) return rows;
    return rows.sort((a, b) => {
      const x = a[key];
      const y = b[key];
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  });
  protected readonly visible = computed(() => (this.expanded() ? this.sorted() : this.sorted().slice(0, PAGE)));
  protected readonly hidden = computed(() => this.block().rows.length - this.visible().length);

  constructor() {
    effect((onCleanup) => {
      if (!this.copied()) return;
      const timer = setTimeout(() => this.copied.set(false), 1500);
      onCleanup(() => clearTimeout(timer));
    });
  }

  protected rowKey(row: Row, index: number) {
    const key = this.block().rowKey;
    return key ? String(row[key]) : index;
  }

  protected isNumber(value: unknown) {
    return typeof value === "number";
  }

  protected sortBy(column: TableColumn) {
    if (this.sortKey() === column.key) {
      if (this.sortDir() === 1) this.sortDir.set(-1);
      else this.sortKey.set(null);
    } else {
      this.sortKey.set(column.key);
      this.sortDir.set(numeric(column) ? -1 : 1);
    }
  }

  protected runRowAction(action: UiAction, row: Row) {
    if (action.prompt) this.actions.sendPrompt(fillTemplate(action.prompt, row));
    else this.actions.emitAction({ ...action, payload: row });
  }

  protected async copyCsv() {
    const { columns } = this.block();
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [columns.map((c) => escape(c.label)).join(","), ...this.sorted().map((row) => columns.map((c) => escape(row[c.key])).join(","))];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      this.copied.set(true);
    } catch {
      // Clipboard access can be refused; nothing else to do.
    }
  }
}
