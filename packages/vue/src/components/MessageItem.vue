<script setup lang="ts">
import { computed } from "vue";
import type { ChatMessage } from "@klymbak/protocol";
import { formatTokens, referenceParts, referenceView } from "@klymbak/client";
import { useI18n } from "../context";
import MarkdownContent from "./MarkdownContent.vue";
import KlIcon from "./KlIcon.vue";
import ThinkingBlock from "./ThinkingBlock.vue";
import ToolCallCard from "./ToolCallCard.vue";

const props = defineProps<{ message: ChatMessage; compact?: boolean; showMeta?: boolean }>();
const i18n = useI18n();

const references = computed(() => referenceParts(props.message.parts).map(referenceView));
const streaming = computed(() => props.message.status === "streaming");
const lastIndex = computed(() => props.message.parts.length - 1);
const isFinalAnswer = computed(() => !props.message.parts.some((p) => p.type === "tool"));
const hasContent = computed(() => props.message.parts.some((p) => (p.type === "text" ? p.text.trim() : true)));

const ORIGIN = { steer: "message.origin.steer", hook: "message.origin.hook", schedule: "message.origin.schedule" } as const;
const origin = computed(() => (props.message.origin && props.message.origin !== "user" ? i18n.t(ORIGIN[props.message.origin]) : undefined));
</script>

<template>
  <div v-if="message.role === 'user'" class="kl-msg kl-msg--user" :class="{ 'kl-msg--compact': compact }">
    <span v-if="origin" class="kl-msg__origin">
      <KlIcon :name="message.origin === 'schedule' ? 'clock' : 'sparkle'" :size="12" /> {{ origin }}
    </span>
    <div class="kl-msg__bubble">
      <div v-if="references.length" class="kl-msg__refs">
        <span v-for="(reference, i) in references" :key="i" class="kl-ref" :class="{ 'kl-ref--prompt': reference.icon === 'chat' }" :title="reference.title">
          <KlIcon :name="reference.icon" :size="12" />
          <span class="kl-ref__name">{{ reference.name }}</span>
          <span v-if="reference.detail" class="kl-ref__detail">{{ reference.detail }}</span>
        </span>
      </div>
      <template v-for="(part, i) in message.parts" :key="i">
        <p v-if="part.type === 'text'" class="kl-msg__text">{{ part.text }}</p>
        <img v-else-if="part.type === 'image'" class="kl-msg__image" :src="`data:${part.mimeType};base64,${part.data}`" :alt="i18n.t('message.attachedImage')" />
      </template>
    </div>
  </div>

  <div v-else-if="message.role === 'notice'" class="kl-notice" :class="`kl-notice--${message.level ?? 'info'}`" role="status">
    <KlIcon :name="message.level === 'error' || message.level === 'warning' ? 'alert' : 'info'" :size="14" />
    <span>{{ message.parts.map((p) => (p.type === "text" ? p.text : "")).join("") }}</span>
  </div>

  <div v-else class="kl-msg kl-msg--assistant" :class="{ 'kl-msg--compact': compact }">
    <template v-for="(part, i) in message.parts" :key="i">
      <ThinkingBlock v-if="part.type === 'thinking'" :text="part.text" :redacted="part.redacted" :active="streaming && i === lastIndex" />
      <MarkdownContent v-else-if="part.type === 'text' && part.text.trim()" :source="part.text" :streaming="streaming && i === lastIndex" />
      <ToolCallCard v-else-if="part.type === 'tool'" :part="part" :compact="compact" />
    </template>
    <div v-if="streaming && !hasContent" class="kl-msg__waiting"><span class="kl-spinner" /> {{ i18n.t("message.working") }}</div>
    <div v-if="message.status === 'error' && message.error" class="kl-notice kl-notice--error">
      <KlIcon name="alert" :size="14" /> <span>{{ message.error }}</span>
    </div>
    <div v-if="message.status === 'aborted'" class="kl-msg__meta">{{ i18n.t("message.stopped") }}</div>
    <div v-else-if="showMeta && isFinalAnswer && message.status === 'done' && message.usage" class="kl-msg__meta kl-num">
      {{ message.model?.id }} · {{ i18n.t("message.tokens", { count: message.usage.totalTokens ?? 0, tokens: formatTokens(message.usage.totalTokens) }) }}<template v-if="message.usage.cost"> · ${{ message.usage.cost.toFixed(4) }}</template>
    </div>
  </div>
</template>
