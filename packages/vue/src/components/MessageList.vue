<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import type { ChatMessage } from "@klymbak/protocol";
import { useI18n } from "../context";
import MessageItem from "./MessageItem.vue";
import KlIcon from "./KlIcon.vue";

const props = defineProps<{ messages: readonly ChatMessage[]; running?: boolean; showMeta?: boolean }>();
const i18n = useI18n();

const scroller = ref<HTMLElement>();
const pinned = ref(true);

function nearBottom() {
  const el = scroller.value;
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom(smooth = false) {
  const el = scroller.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  pinned.value = true;
}

/** Changes whenever the visible tail of the conversation grows. Cheap to compute on every delta. */
function tailSignature() {
  const last = props.messages[props.messages.length - 1];
  const part = last?.parts[last.parts.length - 1];
  let size = 0;
  if (part?.type === "text" || part?.type === "thinking") size = part.text.length;
  else if (part?.type === "tool") size = part.status.length * 1000 + (part.result ? 1 : 0) + (part.subagent?.messages.length ?? 0) * 10;
  return `${props.messages.length}:${last?.parts.length}:${size}`;
}

// Follow the stream while the reader is at the bottom; leave them alone once they scroll up.
watch(
  tailSignature,
  async () => {
    if (!pinned.value) return;
    await nextTick();
    scrollToBottom();
  },
);

watch(
  () => props.messages[0]?.id,
  async () => {
    await nextTick();
    scrollToBottom();
  },
);

onMounted(() => scrollToBottom());
</script>

<template>
  <div ref="scroller" class="kl-list kl-scroll" @scroll="pinned = nearBottom()">
    <div class="kl-list__inner">
      <slot v-if="!messages.length" name="empty" />
      <MessageItem v-for="message in messages" :key="message.id" :message="message" :show-meta="showMeta" />
      <div class="kl-sr-only" aria-live="polite">{{ running ? i18n.t("messages.working") : "" }}</div>
    </div>
    <button v-if="!pinned" type="button" class="kl-list__jump kl-btn kl-btn--sm" @click="scrollToBottom(true)">
      <KlIcon name="arrowDown" :size="12" /> {{ i18n.t("messages.latest") }}
    </button>
  </div>
</template>
