<script setup lang="ts">
import type { ActionsBlock, UiAction } from "@klymbak/protocol";
import { useChatActions } from "../../context";
import KlIcon from "../KlIcon.vue";

defineProps<{ block: ActionsBlock }>();
const actions = useChatActions();

function run(action: UiAction) {
  if (action.kind === "link" && action.href) return;
  if (action.prompt && action.kind !== "event") actions.sendPrompt(action.prompt);
  else actions.emitAction(action);
}
</script>

<template>
  <div class="kl-actions">
    <span v-if="block.title" class="kl-actions__title">{{ block.title }}</span>
    <template v-for="action in block.actions" :key="action.label">
      <a v-if="action.kind === 'link' && action.href" class="kl-btn kl-btn--sm" :href="action.href" target="_blank" rel="noopener noreferrer">
        {{ action.label }} <KlIcon name="external" :size="12" />
      </a>
      <button v-else type="button" class="kl-btn kl-btn--sm" :class="action.tone === 'danger' ? 'kl-btn--danger' : ''" @click="run(action)">
        {{ action.label }}
      </button>
    </template>
  </div>
</template>
