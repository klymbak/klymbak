<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { ChartBlock } from "@klymbak/protocol";
import { useI18n } from "../../context";

const props = defineProps<{ block: ChartBlock }>();
const i18n = useI18n();

const HEIGHT = 220;
const container = ref<HTMLElement>();
const width = ref(560);
const hover = ref<number | null>(null);
let observer: ResizeObserver | undefined;

onMounted(() => {
  if (!container.value) return;
  width.value = container.value.clientWidth || width.value;
  observer = new ResizeObserver(([entry]) => {
    if (entry) width.value = Math.max(240, entry.contentRect.width);
  });
  observer.observe(container.value);
});
onBeforeUnmount(() => observer?.disconnect());

const series = computed(() => props.block.series);
const data = computed(() => props.block.data);
const n = computed(() => data.value.length);
const valueOf = (row: Record<string, unknown>, key: string) => {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
};

/** Round tick steps (1, 2, 2.5, 5 × 10^k) so every label is a value the axis reaches. */
const scale = computed(() => {
  const values = data.value.flatMap((row) => series.value.map((s) => valueOf(row, s.key)));
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const rough = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let t = bottom; t <= top + step / 2; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return { top, bottom, ticks };
});

const primary = computed(() => series.value[0]);
const tickLabel = (value: number) => i18n.compactNumber(value, primary.value?.format, primary.value?.currency);

const margin = computed(() => {
  const longest = Math.max(...scale.value.ticks.map((t) => tickLabel(t).length));
  return { top: 12, right: 14, bottom: 28, left: Math.max(36, longest * 7 + 14) };
});
const inner = computed(() => ({
  width: Math.max(80, width.value - margin.value.left - margin.value.right),
  height: HEIGHT - margin.value.top - margin.value.bottom,
}));

const y = (value: number) => {
  const { top, bottom } = scale.value;
  return margin.value.top + inner.value.height - ((value - bottom) / (top - bottom)) * inner.value.height;
};
const band = computed(() => inner.value.width / Math.max(1, n.value));
const xCenter = (index: number) => {
  if (props.block.kind === "bar") return margin.value.left + band.value * (index + 0.5);
  return margin.value.left + (n.value <= 1 ? inner.value.width / 2 : (index * inner.value.width) / (n.value - 1));
};

const bars = computed(() => {
  if (props.block.kind !== "bar") return [];
  const groupWidth = band.value * 0.72;
  const barWidth = Math.max(2, groupWidth / series.value.length - (series.value.length > 1 ? 2 : 0));
  return data.value.flatMap((row, i) =>
    series.value.map((s, j) => {
      const value = valueOf(row, s.key);
      const x = xCenter(i) - groupWidth / 2 + j * (groupWidth / series.value.length);
      const top = y(Math.max(0, value));
      const height = Math.abs(y(value) - y(0));
      return { key: `${i}-${s.key}`, x, y: top, width: barWidth, height: Math.max(height, value ? 1 : 0), color: j };
    }),
  );
});

const lines = computed(() => {
  if (props.block.kind === "bar") return [];
  return series.value.map((s, j) => {
    const points = data.value.map((row, i) => [xCenter(i), y(valueOf(row, s.key))] as const);
    const path = points.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join("");
    const area = points.length
      ? `${path}L${points[points.length - 1]![0].toFixed(1)},${y(0).toFixed(1)}L${points[0]![0].toFixed(1)},${y(0).toFixed(1)}Z`
      : "";
    return { key: s.key, path, area, last: points[points.length - 1], color: j };
  });
});

const xLabels = computed(() => {
  const count = n.value;
  if (!count) return [];
  const room = Math.max(1, Math.floor(inner.value.width / 72));
  const every = Math.ceil(count / room);
  const format = props.block.x.format;
  return data.value
    .map((row, i) => ({ i, text: formatX(row[props.block.x.key], format) }))
    .filter(({ i }) => i % every === 0 || i === count - 1)
    .filter((label, k, all) => k === all.length - 1 || all[all.length - 1]!.i - label.i >= every * 0.6);
});

function formatX(value: unknown, format: ChartBlock["x"]["format"]) {
  if (format === "date" && typeof value === "string") {
    const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
    if (!Number.isNaN(date.getTime())) return i18n.formatValue(date, "date");
  }
  return i18n.formatValue(value, format);
}

function onMove(event: PointerEvent) {
  const svg = event.currentTarget as SVGElement;
  const rect = svg.getBoundingClientRect();
  const px = ((event.clientX - rect.left) / rect.width) * width.value;
  if (!n.value) return;
  let nearest = 0;
  let distance = Infinity;
  for (let i = 0; i < n.value; i++) {
    const d = Math.abs(xCenter(i) - px);
    if (d < distance) {
      distance = d;
      nearest = i;
    }
  }
  hover.value = nearest;
}

const tooltip = computed(() => {
  if (hover.value === null) return null;
  const row = data.value[hover.value];
  if (!row) return null;
  const x = xCenter(hover.value);
  return {
    x,
    left: x > width.value * 0.6,
    title: formatX(row[props.block.x.key], props.block.x.format),
    items: series.value.map((s, j) => ({ label: s.label, value: i18n.formatValue(row[s.key], s.format, s.currency), color: j })),
  };
});
</script>

<template>
  <figure class="kl-chart">
    <figcaption v-if="block.title" class="kl-chart__title">
      {{ block.title }}
      <span v-if="series.length > 1" class="kl-chart__legend">
        <span v-for="(s, j) in series" :key="s.key" class="kl-chart__key">
          <i :style="{ background: `var(--kl-series-${(j % 4) + 1})` }" />{{ s.label }}
        </span>
      </span>
    </figcaption>
    <div ref="container" class="kl-chart__plot">
      <svg
        :viewBox="`0 0 ${width} ${HEIGHT}`"
        :width="width"
        :height="HEIGHT"
        role="img"
        :aria-label="i18n.t('chart.label', { title: block.title ?? i18n.t('chart.defaultTitle'), count: n })"
        @pointermove="onMove"
        @pointerleave="hover = null"
      >
        <g class="kl-chart__grid">
          <template v-for="tick in scale.ticks" :key="tick">
            <line :x1="margin.left" :x2="margin.left + inner.width" :y1="y(tick)" :y2="y(tick)" />
            <text :x="margin.left - 8" :y="y(tick)" dy="0.32em" text-anchor="end">{{ tickLabel(tick) }}</text>
          </template>
        </g>
        <g class="kl-chart__xlabels">
          <text v-for="label in xLabels" :key="label.i" :x="xCenter(label.i)" :y="HEIGHT - 8" text-anchor="middle">{{ label.text }}</text>
        </g>
        <g v-if="block.kind === 'bar'">
          <rect
            v-for="bar in bars"
            :key="bar.key"
            :x="bar.x"
            :y="bar.y"
            :width="bar.width"
            :height="bar.height"
            rx="2"
            :fill="`var(--kl-series-${(bar.color % 4) + 1})`"
            :fill-opacity="hover === null || bar.key.startsWith(`${hover}-`) ? 1 : 0.45"
          />
        </g>
        <g v-else>
          <g v-for="line in lines" :key="line.key" :style="{ color: `var(--kl-series-${(line.color % 4) + 1})` }">
            <path v-if="block.kind === 'area'" :d="line.area" fill="currentColor" fill-opacity="0.12" stroke="none" />
            <path :d="line.path" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
            <circle v-if="line.last" :cx="line.last[0]" :cy="line.last[1]" r="3.5" fill="currentColor" stroke="var(--kl-surface)" stroke-width="2" />
          </g>
        </g>
        <line
          v-if="tooltip && block.kind !== 'bar'"
          class="kl-chart__guide"
          :x1="tooltip.x"
          :x2="tooltip.x"
          :y1="margin.top"
          :y2="margin.top + inner.height"
        />
        <line class="kl-chart__baseline" :x1="margin.left" :x2="margin.left + inner.width" :y1="y(0)" :y2="y(0)" />
      </svg>
      <div
        v-if="tooltip"
        class="kl-chart__tooltip"
        :style="{ left: `${(tooltip.x / width) * 100}%`, transform: tooltip.left ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }"
      >
        <strong>{{ tooltip.title }}</strong>
        <span v-for="item in tooltip.items" :key="item.label" class="kl-num">
          <i :style="{ background: `var(--kl-series-${(item.color % 4) + 1})` }" />{{ item.label }}: {{ item.value }}
        </span>
      </div>
    </div>
    <p v-if="block.caption" class="kl-chart__caption">{{ block.caption }}</p>
  </figure>
</template>
