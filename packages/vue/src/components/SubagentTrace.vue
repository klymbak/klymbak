<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SubagentView } from "@klymbak/protocol";
import MarkdownContent from "./MarkdownContent.vue";
import MessageItem from "./MessageItem.vue";
import KlIcon from "./KlIcon.vue";

const props = defineProps<{ subagent: SubagentView; result?: string; done?: boolean }>();

const steps = computed(() =>
  props.subagent.messages.reduce((count, m) => count + m.parts.filter((p) => p.type === "tool").length, 0),
);
const showSteps = ref(props.subagent.status === "running");
watch(
  () => props.subagent.status,
  (status) => {
    if (status !== "running") showSteps.value = false;
  },
);
</script>

<template>
  <div class="kl-sub">
    <div class="kl-sub__head">
      <span class="kl-sub__agent"><KlIcon name="agents" :size="14" /> {{ subagent.agent }}</span>
      <span v-if="subagent.status === 'running'" class="kl-sub__status kl-faint"><span class="kl-spinner" /> working</span>
      <button v-if="subagent.messages.length" type="button" class="kl-btn kl-btn--ghost kl-btn--sm" @click="showSteps = !showSteps">
        {{ showSteps ? "Hide" : "Show" }} {{ steps }} {{ steps === 1 ? "step" : "steps" }}
        <KlIcon :name="showSteps ? 'chevronDown' : 'chevron'" :size="12" />
      </button>
    </div>
    <p class="kl-sub__task">{{ subagent.task }}</p>
    <div v-if="showSteps" class="kl-sub__steps">
      <MessageItem v-for="message in subagent.messages" :key="message.id" :message="message" compact />
    </div>
    <div v-if="done && result" class="kl-sub__result">
      <span class="kl-sub__result-label">Answer</span>
      <MarkdownContent :source="result" />
    </div>
  </div>
</template>
