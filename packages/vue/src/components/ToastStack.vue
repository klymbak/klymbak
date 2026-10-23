<script setup lang="ts">
import { useAgentStore, useI18n } from "../context";
import type { Toast } from "@klymbak/client";
import KlIcon from "./KlIcon.vue";

const emit = defineEmits<{ openSession: [id: string] }>();
const store = useAgentStore();
const i18n = useI18n();

function open(toast: Toast) {
  if (!toast.sessionId) return;
  void store.openSession(toast.sessionId);
  emit("openSession", toast.sessionId);
  store.dismissToast(toast.id);
}

const icons = { success: "check", danger: "alert", warning: "bell", info: "info" } as const;
</script>

<template>
  <div class="kl-toasts" aria-live="polite">
    <TransitionGroup name="kl-toast">
      <div v-for="toast in store.state.toasts" :key="toast.id" class="kl-toast" :class="`kl-tone-${toast.tone}`" role="status">
        <KlIcon :name="icons[toast.tone]" :size="16" class="kl-toast__icon" />
        <div class="kl-toast__body">
          <strong>{{ i18n.text(toast.title) }}</strong>
          <p v-if="toast.body">{{ i18n.text(toast.body) }}</p>
          <button v-if="toast.sessionId" type="button" class="kl-btn kl-btn--sm" @click="open(toast)">{{ i18n.t("toast.open") }}</button>
        </div>
        <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" :aria-label="i18n.t('common.dismiss')" @click="store.dismissToast(toast.id)">
          <KlIcon name="close" :size="12" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
