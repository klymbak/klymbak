<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { UiAction } from "@klymbak/protocol";
import { createAgentClient, type AgentClientOptions } from "@klymbak/client";
import { provideAgentStore, provideRenderers, provideRoot, useOptionalAgentStore, type KlymbakRenderers } from "../context";
import { createAgentStore, type AgentStore } from "../store";
import AgentChat from "./AgentChat.vue";
import CapabilitiesPanel from "./CapabilitiesPanel.vue";
import KlIcon from "./KlIcon.vue";
import SchedulePanel from "./SchedulePanel.vue";
import SessionList from "./SessionList.vue";
import ToastStack from "./ToastStack.vue";

const props = withDefaults(
  defineProps<{
    store?: AgentStore;
    baseUrl?: string;
    headers?: AgentClientOptions["headers"];
    title?: string;
    suggestions?: string[];
    theme?: "auto" | "light" | "dark";
    renderers?: KlymbakRenderers;
    showMeta?: boolean;
  }>(),
  { theme: "auto", showMeta: true },
);
const emit = defineEmits<{ action: [action: UiAction] }>();

defineSlots<{
  brand?: () => unknown;
  "sidebar-footer"?: () => unknown;
  "header-end"?: () => unknown;
}>();

const injected = useOptionalAgentStore();
const owned = !props.store && !injected;
if (owned && !props.baseUrl) throw new Error("<AgentWorkspace> needs a `store`, the Klymbak plugin, or a `base-url`.");
const store: AgentStore =
  props.store ?? injected ?? createAgentStore({ client: createAgentClient({ baseUrl: props.baseUrl!, headers: props.headers }) });
provideAgentStore(store);
if (props.renderers) provideRenderers(props.renderers);
provideRoot();

type Tab = "chats" | "schedules" | "capabilities";
const tab = ref<Tab>("chats");
const drawer = ref(false);
const state = store.state;
const tabs = computed(() =>
  [
    { id: "chats" as const, label: "Chats", icon: "chat", badge: store.unreadCount.value || undefined },
    ...(state.config?.features.schedules ? [{ id: "schedules" as const, label: "Schedules", icon: "clock", badge: undefined }] : []),
    { id: "capabilities" as const, label: "Tools", icon: "tool", badge: undefined },
  ],
);

function showChat() {
  tab.value = "chats";
  drawer.value = false;
}

onMounted(() => {
  if (!state.ready) void store.init();
});
onBeforeUnmount(() => {
  if (owned) store.dispose();
});
</script>

<template>
  <div class="kl-root kl-workspace" :data-kl-theme="theme" :class="{ 'kl-workspace--drawer': drawer }">
    <aside class="kl-workspace__sidebar" aria-label="Agent navigation">
      <div class="kl-workspace__brand">
        <slot name="brand">
          <span class="kl-workspace__logo"><KlIcon name="sparkle" :size="16" /></span>
          <span class="kl-workspace__app">{{ title ?? state.config?.app.name ?? "Assistant" }}</span>
        </slot>
        <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-workspace__close" aria-label="Close menu" @click="drawer = false">
          <KlIcon name="close" :size="16" />
        </button>
      </div>
      <div class="kl-workspace__tabs" role="tablist">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          role="tab"
          :aria-selected="tab === item.id"
          class="kl-workspace__tab"
          :class="{ active: tab === item.id }"
          @click="tab = item.id"
        >
          <KlIcon :name="item.icon" :size="14" /> {{ item.label }}
          <span v-if="item.badge" class="kl-workspace__badge">{{ item.badge }}</span>
        </button>
      </div>
      <div class="kl-workspace__panel kl-scroll">
        <SessionList v-if="tab === 'chats'" @open="drawer = false" />
        <SchedulePanel v-else-if="tab === 'schedules'" @open-session="showChat" />
        <CapabilitiesPanel v-else />
      </div>
      <div class="kl-workspace__footer">
        <slot name="sidebar-footer">
          <template v-if="state.config">
            <span class="kl-workspace__avatar">{{ state.config.user.name.slice(0, 1) }}</span>
            <span class="kl-workspace__user">
              <strong>{{ state.config.user.name }}</strong>
              <span class="kl-faint">{{ state.config.user.roles.join(", ") }}</span>
            </span>
          </template>
        </slot>
      </div>
    </aside>
    <div class="kl-workspace__scrim" @click="drawer = false" />
    <main class="kl-workspace__main">
      <AgentChat :suggestions="suggestions" :show-meta="showMeta" @action="emit('action', $event)">
        <template #header-start>
          <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-workspace__menu" aria-label="Open menu" @click="drawer = true">
            <KlIcon name="menu" :size="18" />
          </button>
        </template>
        <template #header-end><slot name="header-end" /></template>
      </AgentChat>
    </main>
    <ToastStack @open-session="showChat" />
  </div>
</template>
