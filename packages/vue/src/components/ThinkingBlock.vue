<script setup lang="ts">
import { ref } from "vue";
import KlIcon from "./KlIcon.vue";

const props = defineProps<{ text: string; active?: boolean; redacted?: boolean }>();
const open = ref(false);
</script>

<template>
  <div v-if="props.text.trim() || props.redacted || props.active" class="kl-think">
    <button type="button" class="kl-think__toggle" :aria-expanded="open" @click="open = !open">
      <KlIcon name="brain" :size="14" />
      <span>{{ active ? "Thinking" : "Reasoning" }}</span>
      <span v-if="active" class="kl-think__dots" aria-hidden="true"><i /><i /><i /></span>
      <KlIcon :name="open ? 'chevronDown' : 'chevron'" :size="12" />
    </button>
    <p v-if="open || (active && text)" class="kl-think__text" :class="{ 'kl-think__text--live': active && !open }">
      {{ redacted ? "The model's reasoning is hidden by the provider." : text.trim() }}
    </p>
  </div>
</template>
