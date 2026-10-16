<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "@klymbak/client";

const props = defineProps<{ source: string; streaming?: boolean }>();
const html = computed(() => renderMarkdown(props.source));
</script>

<template>
  <!-- markdown-it runs with html disabled, so model output cannot inject markup. -->
  <div class="kl-md" :class="{ 'kl-md--streaming': streaming }" v-html="html" />
</template>
