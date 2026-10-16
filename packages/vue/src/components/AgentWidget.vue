<script setup lang="ts">
import { ref } from "vue";
import type { UiAction } from "@klymbak/protocol";
import { createAgentClient, type AgentClientOptions } from "@klymbak/client";
import { provideAgentStore, provideRenderers, provideRoot, useOptionalAgentStore, type KlymbakRenderers } from "../context";
import { createAgentStore, type AgentStore } from "../store";
import AgentChat from "./AgentChat.vue";
import KlIcon from "./KlIcon.vue";
import ToastStack from "./ToastStack.vue";

/**
 * A floating launcher + chat panel that drops into any existing page,
 * so teams can add the agent next to their current admin panel first.
 */
const props = withDefaults(
  defineProps<{
    store?: AgentStore;
    baseUrl?: string;
    headers?: AgentClientOptions["headers"];
    title?: string;
    label?: string;
    suggestions?: string[];
    theme?: "auto" | "light" | "dark";
    renderers?: KlymbakRenderers;
    position?: "right" | "left";
    defaultOpen?: boolean;
  }>(),
  { label: "Ask the agent", theme: "auto", position: "right", defaultOpen: false },
);
const emit = defineEmits<{ action: [action: UiAction] }>();

const injected = useOptionalAgentStore();
if (!props.store && !injected && !props.baseUrl) throw new Error("<AgentWidget> needs a `store`, the Klymbak plugin, or a `base-url`.");
const store: AgentStore =
  props.store ?? injected ?? createAgentStore({ client: createAgentClient({ baseUrl: props.baseUrl!, headers: props.headers }) });
provideAgentStore(store);
if (props.renderers) provideRenderers(props.renderers);
provideRoot();

const open = ref(props.defaultOpen);
</script>

<template>
  <div class="kl-root kl-widget" :class="`kl-widget--${position}`" :data-kl-theme="theme">
    <Transition name="kl-widget">
      <div v-show="open" class="kl-widget__panel" role="dialog" :aria-label="title ?? 'Agent'">
        <AgentChat :title="title" :suggestions="suggestions" @action="emit('action', $event)">
          <template #header-end>
            <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" aria-label="Close" @click="open = false">
              <KlIcon name="close" :size="14" />
            </button>
          </template>
        </AgentChat>
      </div>
    </Transition>
    <button v-if="!open" type="button" class="kl-widget__launcher" @click="open = true">
      <KlIcon name="sparkle" :size="18" />
      <span>{{ label }}</span>
      <span v-if="store.approvals.value.length" class="kl-widget__dot" aria-label="Approval waiting" />
    </button>
    <ToastStack @open-session="open = true" />
  </div>
</template>
