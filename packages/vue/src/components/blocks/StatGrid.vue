<script setup lang="ts">
import type { StatItem, StatsBlock } from "@klymbak/protocol";
import { toneClass } from "@klymbak/client";
import { useI18n } from "../../context";
import KlIcon from "../KlIcon.vue";

defineProps<{ block: StatsBlock }>();
const i18n = useI18n();

function deltaTone(item: StatItem) {
  if (item.delta === undefined || item.delta === 0) return "neutral";
  const good = item.invertDelta ? item.delta < 0 : item.delta > 0;
  return good ? "success" : "danger";
}

function deltaText(delta: number) {
  return `${Math.abs(delta * 100).toFixed(Math.abs(delta) < 0.1 ? 1 : 0)}%`;
}
</script>

<template>
  <section class="kl-stats">
    <h4 v-if="block.title" class="kl-stats__title">{{ block.title }}</h4>
    <div class="kl-stats__grid">
      <div v-for="item in block.items" :key="item.label" class="kl-stat" :class="item.tone ? toneClass(item.tone) : ''">
        <span class="kl-stat__label">{{ item.label }}</span>
        <span class="kl-stat__value kl-num">{{ typeof item.value === "number" ? i18n.formatValue(item.value, item.format, item.currency) : item.value }}</span>
        <span v-if="item.delta !== undefined" class="kl-stat__delta kl-num" :class="toneClass(deltaTone(item))">
          <KlIcon :name="item.delta >= 0 ? 'arrowUp' : 'arrowDown'" :size="12" />
          {{ deltaText(item.delta) }}
          <span v-if="item.deltaLabel" class="kl-stat__delta-label">{{ item.deltaLabel }}</span>
        </span>
      </div>
    </div>
  </section>
</template>
