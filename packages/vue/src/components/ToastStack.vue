<script setup lang="ts">
import { useAgentStore } from "../context";
import type { Toast } from "@klymbak/client";
import KlIcon from "./KlIcon.vue";

const emit = defineEmits<{ openSession: [id: string] }>();
const store = useAgentStore();

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
          <strong>{{ toast.title }}</strong>
          <p v-if="toast.body">{{ toast.body }}</p>
          <button v-if="toast.sessionId" type="button" class="kl-btn kl-btn--sm" @click="open(toast)">Open</button>
        </div>
        <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" aria-label="Dismiss" @click="store.dismissToast(toast.id)">
          <KlIcon name="close" :size="12" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
