<script setup lang="ts">
import { computed, ref } from "vue";
import type { SourcesBlock } from "@klymbak/protocol";
import { safeUrl } from "@klymbak/client";
import { useI18n } from "../../context";
import KlIcon from "../KlIcon.vue";

const PAGE = 4;
/** Excerpts longer than this show three lines until opened. */
const LONG_EXCERPT = 300;

const props = defineProps<{ block: SourcesBlock }>();
const i18n = useI18n();
const expanded = ref(false);
const open = ref<ReadonlySet<number>>(new Set());

const visible = computed(() => (expanded.value ? props.block.items : props.block.items.slice(0, PAGE)));
const hidden = computed(() => props.block.items.length - visible.value.length);
const rows = computed(() =>
  visible.value.map((item) => ({
    item,
    url: safeUrl(item.url),
    where: [item.source, item.location].filter(Boolean).join(" · "),
    long: (item.excerpt?.length ?? 0) > LONG_EXCERPT,
  })),
);

function toggle(index: number) {
  const next = new Set(open.value);
  if (!next.delete(index)) next.add(index);
  open.value = next;
}
</script>

<template>
  <section class="kl-sources">
    <div class="kl-sources__bar">
      <KlIcon name="file" :size="14" />
      <span class="kl-sources__title">{{ block.title ?? i18n.t("sources.title") }}</span>
      <span v-if="block.items.length > 1" class="kl-sources__count kl-num">{{ i18n.t("sources.count", { count: block.items.length }) }}</span>
    </div>
    <ol class="kl-sources__list">
      <li v-for="(row, i) in rows" :key="`${i}:${row.item.url ?? row.item.title}`" class="kl-sources__item">
        <span class="kl-sources__n kl-num">{{ i + 1 }}</span>
        <a
          v-if="row.url"
          class="kl-sources__name"
          :href="row.url"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="i18n.t('sources.open', { title: row.item.title })"
          >{{ row.item.title }}<KlIcon name="external" :size="12"
        /></a>
        <span v-else class="kl-sources__name">{{ row.item.title }}</span>
        <span v-if="row.where" class="kl-sources__where">{{ row.where }}</span>
        <p v-if="row.item.excerpt" class="kl-sources__excerpt" :class="{ 'kl-sources__excerpt--clamped': row.long && !open.has(i) }">{{ row.item.excerpt }}</p>
        <button v-if="row.long" type="button" class="kl-btn kl-btn--ghost kl-btn--sm kl-sources__toggle" :aria-expanded="open.has(i)" @click="toggle(i)">
          {{ i18n.t(open.has(i) ? "sources.collapse" : "sources.expand") }}
        </button>
      </li>
    </ol>
    <div v-if="hidden > 0 || (expanded && block.items.length > PAGE)" class="kl-sources__foot">
      <button type="button" class="kl-btn kl-btn--ghost kl-btn--sm" @click="expanded = hidden > 0">
        {{ hidden > 0 ? i18n.t("common.showMore", { count: hidden }) : i18n.t("common.showFewer") }}
      </button>
    </div>
  </section>
</template>
