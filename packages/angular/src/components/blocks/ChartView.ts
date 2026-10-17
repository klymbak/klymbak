import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal, viewChild } from "@angular/core";
import type { ChartBlock } from "@klymbak/protocol";
import { compactNumber, formatValue } from "@klymbak/client";

const HEIGHT = 220;

const valueOf = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
};

function formatX(value: unknown, format: ChartBlock["x"]["format"]) {
  if (format === "date" && typeof value === "string") {
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    if (!Number.isNaN(date.getTime())) return formatValue(date, "date");
  }
  return formatValue(value, format);
}

const seriesColor = (index: number) => `var(--kl-series-${(index % 4) + 1})`;

@Component({
  selector: "kl-chart-view",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    @let b = block();
    @let c = chart();
    @let tip = tooltip();
    <figure class="kl-chart">
      @if (b.title) {
        <figcaption class="kl-chart__title">{{ b.title }}@if (b.series.length > 1) {
            <span class="kl-chart__legend">
              @for (s of b.series; track s.key; let j = $index) {
                <span class="kl-chart__key"><i [style.background]="seriesColor(j)"></i>{{ s.label }}</span>
              }
            </span>
          }</figcaption>
      }
      <div #container class="kl-chart__plot">
        <svg
          [attr.viewBox]="'0 0 ' + width() + ' ' + HEIGHT"
          [attr.width]="width()"
          [attr.height]="HEIGHT"
          role="img"
          [attr.aria-label]="(b.title ?? 'Chart') + ': ' + b.data.length + ' data points'"
          (pointermove)="onMove($event)"
          (pointerleave)="hover.set(null)"
        >
          <g class="kl-chart__grid">
            @for (tick of c.ticks; track tick.value) {
              <line [attr.x1]="c.left" [attr.x2]="c.right" [attr.y1]="tick.y" [attr.y2]="tick.y" />
              <text [attr.x]="c.left - 8" [attr.y]="tick.y" dy="0.32em" text-anchor="end">{{ tick.label }}</text>
            }
          </g>
          <g class="kl-chart__xlabels">
            @for (label of c.xLabels; track label.i) {
              <text [attr.x]="label.x" [attr.y]="HEIGHT - 8" text-anchor="middle">{{ label.text }}</text>
            }
          </g>
          @if (b.kind === "bar") {
            <g>
              @for (bar of c.bars; track bar.key) {
                <rect
                  [attr.x]="bar.x"
                  [attr.y]="bar.y"
                  [attr.width]="bar.width"
                  [attr.height]="bar.height"
                  rx="2"
                  [attr.fill]="seriesColor(bar.color)"
                  [attr.fill-opacity]="hover() === null || bar.index === hover() ? 1 : 0.45"
                />
              }
            </g>
          } @else {
            <g>
              @for (line of c.lines; track line.key) {
                <g [style.color]="seriesColor(line.color)">
                  @if (b.kind === "area") {
                    <path [attr.d]="line.area" fill="currentColor" fill-opacity="0.12" stroke="none" />
                  }
                  <path [attr.d]="line.path" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
                  @if (line.last) {
                    <circle [attr.cx]="line.last[0]" [attr.cy]="line.last[1]" r="3.5" fill="currentColor" stroke="var(--kl-surface)" stroke-width="2" />
                  }
                </g>
              }
            </g>
          }
          @if (tip && b.kind !== "bar") {
            <line class="kl-chart__guide" [attr.x1]="tip.x" [attr.x2]="tip.x" [attr.y1]="c.top" [attr.y2]="c.bottom" />
          }
          <line class="kl-chart__baseline" [attr.x1]="c.left" [attr.x2]="c.right" [attr.y1]="c.zero" [attr.y2]="c.zero" />
        </svg>
        @if (tip) {
          <div
            class="kl-chart__tooltip"
            [style.left.%]="(tip.x / width()) * 100"
            [style.transform]="tip.left ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)'"
          >
            <strong>{{ tip.title }}</strong>
            @for (item of tip.items; track item.label) {
              <span class="kl-num"><i [style.background]="seriesColor(item.color)"></i>{{ item.label }}: {{ item.value }}</span>
            }
          </div>
        }
      </div>
      @if (b.caption) {
        <p class="kl-chart__caption">{{ b.caption }}</p>
      }
    </figure>
  `,
})
export class ChartView {
  readonly block = input.required<ChartBlock>();
  private readonly container = viewChild.required<ElementRef<HTMLElement>>("container");
  protected readonly width = signal(560);
  protected readonly hover = signal<number | null>(null);
  protected readonly HEIGHT = HEIGHT;
  protected readonly seriesColor = seriesColor;

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const el = this.container().nativeElement;
      this.width.update((current) => el.clientWidth || current);
      const observer = new ResizeObserver(([entry]) => {
        if (entry) this.width.set(Math.max(240, entry.contentRect.width));
      });
      observer.observe(el);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected readonly chart = computed(() => {
    const block = this.block();
    const width = this.width();
    const { series, data } = block;
    const n = data.length;

    // Round tick steps (1, 2, 2.5, 5 × 10^k) so every label is a value the axis reaches.
    const values = data.flatMap((row) => series.map((s) => valueOf(row, s.key)));
    const max = Math.max(0, ...values);
    const min = Math.min(0, ...values);
    const rough = (max - min || 1) / 4;
    const magnitude = 10 ** Math.floor(Math.log10(rough));
    const normalized = rough / magnitude;
    const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
    const top = Math.ceil(max / step) * step || step;
    const bottom = Math.floor(min / step) * step;
    const tickValues: number[] = [];
    for (let t = bottom; t <= top + step / 2; t += step) tickValues.push(Math.round(t * 1e6) / 1e6);

    const primary = series[0];
    const tickLabel = (value: number) => compactNumber(value, primary?.format, primary?.currency);

    const longest = Math.max(...tickValues.map((t) => tickLabel(t).length));
    const margin = { top: 12, right: 14, bottom: 28, left: Math.max(36, longest * 7 + 14) };
    const inner = { width: Math.max(80, width - margin.left - margin.right), height: HEIGHT - margin.top - margin.bottom };

    const y = (value: number) => margin.top + inner.height - ((value - bottom) / (top - bottom)) * inner.height;
    const band = inner.width / Math.max(1, n);
    const xCenter = (index: number) => {
      if (block.kind === "bar") return margin.left + band * (index + 0.5);
      return margin.left + (n <= 1 ? inner.width / 2 : (index * inner.width) / (n - 1));
    };

    const bars =
      block.kind !== "bar"
        ? []
        : data.flatMap((row, i) => {
            const groupWidth = band * 0.72;
            const barWidth = Math.max(2, groupWidth / series.length - (series.length > 1 ? 2 : 0));
            return series.map((s, j) => {
              const value = valueOf(row, s.key);
              const x = xCenter(i) - groupWidth / 2 + j * (groupWidth / series.length);
              const height = Math.abs(y(value) - y(0));
              return { key: `${i}-${s.key}`, index: i, x, y: y(Math.max(0, value)), width: barWidth, height: Math.max(height, value ? 1 : 0), color: j };
            });
          });

    const lines =
      block.kind === "bar"
        ? []
        : series.map((s, j) => {
            const points = data.map((row, i) => [xCenter(i), y(valueOf(row, s.key))] as const);
            const path = points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
            const area = points.length
              ? `${path}L${points[points.length - 1]![0].toFixed(1)},${y(0).toFixed(1)}L${points[0]![0].toFixed(1)},${y(0).toFixed(1)}Z`
              : "";
            return { key: s.key, path, area, last: points[points.length - 1], color: j };
          });

    const xLabels = (() => {
      if (!n) return [];
      const room = Math.max(1, Math.floor(inner.width / 72));
      const every = Math.ceil(n / room);
      return data
        .map((row, i) => ({ i, x: xCenter(i), text: formatX(row[block.x.key], block.x.format) }))
        .filter(({ i }) => i % every === 0 || i === n - 1)
        .filter((label, k, all) => k === all.length - 1 || all[all.length - 1]!.i - label.i >= every * 0.6);
    })();

    return {
      ticks: tickValues.map((value) => ({ value, y: y(value), label: tickLabel(value) })),
      xLabels,
      bars,
      lines,
      xCenter,
      left: margin.left,
      right: margin.left + inner.width,
      top: margin.top,
      bottom: margin.top + inner.height,
      zero: y(0),
    };
  });

  protected readonly tooltip = computed(() => {
    const index = this.hover();
    const block = this.block();
    const hovered = index === null ? undefined : block.data[index];
    if (index === null || !hovered) return null;
    const x = this.chart().xCenter(index);
    return {
      x,
      left: x > this.width() * 0.6,
      title: formatX(hovered[block.x.key], block.x.format),
      items: block.series.map((s, j) => ({ label: s.label, value: formatValue(hovered[s.key], s.format, s.currency), color: j })),
    };
  });

  protected onMove(event: PointerEvent) {
    const n = this.block().data.length;
    if (!n) return;
    const rect = (event.currentTarget as Element).getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * this.width();
    const { xCenter } = this.chart();
    let nearest = 0;
    let distance = Infinity;
    for (let i = 0; i < n; i++) {
      const d = Math.abs(xCenter(i) - px);
      if (d < distance) {
        distance = d;
        nearest = i;
      }
    }
    this.hover.set(nearest);
  }
}
