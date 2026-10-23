<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "../context";
import KlIcon from "./KlIcon.vue";

const props = defineProps<{ text: string; active?: boolean; redacted?: boolean }>();
const i18n = useI18n();
const open = ref(false);
</script>

<template>
  <div v-if="props.text.trim() || props.redacted || props.active" class="kl-think">
    <button type="button" class="kl-think__toggle" :aria-expanded="open" @click="open = !open">
      <KlIcon name="brain" :size="14" />
      <span>{{ i18n.t(active ? "thinking.active" : "thinking.done") }}</span>
      <span v-if="active" class="kl-think__dots" aria-hidden="true"><i /><i /><i /></span>
      <KlIcon :name="open ? 'chevronDown' : 'chevron'" :size="12" />
    </button>
    <p v-if="open || (active && text)" class="kl-think__text" :class="{ 'kl-think__text--live': active && !open }">
      {{ redacted ? i18n.t("thinking.redacted") : text.trim() }}
    </p>
  </div>
</template>
