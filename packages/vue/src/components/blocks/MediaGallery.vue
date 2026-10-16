<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { mediaKind, type MediaBlock } from "@klymbak/protocol";
import { mediaMeta, mediaName, mediaType, safeUrl } from "@klymbak/client";
import KlIcon from "../KlIcon.vue";

const props = defineProps<{ block: MediaBlock }>();

const PAGE = 12;
const expanded = ref(false);
// A file whose preview fails to load (deleted, or a path this page can't reach) shows as a file tile.
const broken = reactive(new Set<string>());

const visible = computed(() => (expanded.value ? props.block.items : props.block.items.slice(0, PAGE)));
const hidden = computed(() => props.block.items.length - visible.value.length);
const total = computed(() => props.block.totalItems ?? props.block.items.length);

const cards = computed(() =>
  visible.value.map((item) => {
    const url = safeUrl(item.url);
    return {
      item,
      url,
      kind: url && !broken.has(url) ? mediaKind(item) : "file",
      name: mediaName(item),
      meta: mediaMeta(item),
      type: mediaType(item) ?? "File",
    };
  }),
);
</script>

<template>
  <div class="kl-media" :class="{ 'kl-media--single': block.items.length === 1 }">
    <div v-if="block.title || block.items.length > 1" class="kl-media__bar">
      <span class="kl-media__title">{{ block.title }}</span>
      <span class="kl-media__count kl-num">{{ total.toLocaleString() }} {{ total === 1 ? "file" : "files" }}</span>
    </div>
    <ul class="kl-media__grid">
      <li v-for="(card, i) in cards" :key="`${i}:${card.item.url}`">
        <figure class="kl-media__item">
          <div v-if="card.kind === 'video'" class="kl-media__preview">
            <video :src="card.url" controls muted playsinline preload="metadata" @error="broken.add(card.url!)" />
          </div>
          <component
            :is="card.url ? 'a' : 'div'"
            v-else
            class="kl-media__preview"
            v-bind="card.url ? { href: card.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Open ${card.name}` } : {}"
          >
            <img v-if="card.kind === 'image'" :src="card.url" :alt="card.item.alt ?? ''" loading="lazy" decoding="async" @error="broken.add(card.url!)" />
            <span v-else class="kl-media__file"><KlIcon name="file" :size="28" />{{ card.type }}</span>
          </component>
          <figcaption>
            <span class="kl-media__name" :title="card.name">{{ card.name }}</span>
            <span v-if="card.meta" class="kl-media__meta kl-num">{{ card.meta }}</span>
            <span v-if="card.item.caption" class="kl-media__caption" :title="card.item.caption">{{ card.item.caption }}</span>
          </figcaption>
        </figure>
      </li>
    </ul>
    <div v-if="hidden > 0 || expanded || block.caption || total > block.items.length" class="kl-media__foot">
      <button v-if="hidden > 0" type="button" class="kl-btn kl-btn--ghost kl-btn--sm" @click="expanded = true">
        Show {{ hidden }} more
      </button>
      <button v-else-if="expanded && block.items.length > PAGE" type="button" class="kl-btn kl-btn--ghost kl-btn--sm" @click="expanded = false">
        Show fewer
      </button>
      <span v-if="total > block.items.length" class="kl-faint">Showing {{ block.items.length }} of {{ total.toLocaleString() }}</span>
      <span v-if="block.caption" class="kl-faint kl-media__foot-caption">{{ block.caption }}</span>
    </div>
  </div>
</template>
