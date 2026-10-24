<script setup lang="ts">
import { ref } from "vue";
import type { UiAction } from "@klymbak/protocol";
import { createAgentClient, type AgentClientOptions, type Messages } from "@klymbak/client";
import { provideAgentStore, provideI18n, provideRenderers, provideRoot, useOptionalAgentStore, type KlymbakRenderers } from "../context";
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
    /** Text under the title on the welcome screen. Defaults to the server's app.description. */
    description?: string;
    label?: string;
    suggestions?: string[];
    theme?: "auto" | "light" | "dark";
    renderers?: KlymbakRenderers;
    position?: "right" | "left";
    defaultOpen?: boolean;
    /** The interface language, a BCP 47 tag such as "fr". Numbers and dates follow it too. */
    locale?: string;
    /** Messages in that language, e.g. the default export of `@klymbak/client/locales/fr`. Missing ones are shown in English. */
    messages?: Partial<Messages>;
  }>(),
  { theme: "auto", position: "right", defaultOpen: false },
);
const emit = defineEmits<{ action: [action: UiAction] }>();

const injected = useOptionalAgentStore();
if (!props.store && !injected && !props.baseUrl) throw new Error("<AgentWidget> needs a `store`, the Klymbak plugin, or a `base-url`.");
const store: AgentStore =
  props.store ?? injected ?? createAgentStore({ client: createAgentClient({ baseUrl: props.baseUrl!, headers: props.headers }) });
provideAgentStore(store);
if (props.renderers) provideRenderers(props.renderers);
provideRoot();
const i18n = provideI18n(() => ({ locale: props.locale, messages: props.messages }));

const open = ref(props.defaultOpen);
</script>

<template>
  <div class="kl-root kl-widget" :class="`kl-widget--${position}`" :data-kl-theme="theme">
    <Transition name="kl-widget">
      <div v-show="open" class="kl-widget__panel" role="dialog" :aria-label="title ?? i18n.t('widget.label')">
        <AgentChat :title="title" :description="description" :suggestions="suggestions" @action="emit('action', $event)">
          <template #header-end>
            <button type="button" class="kl-btn kl-btn--ghost kl-btn--icon kl-btn--sm" :aria-label="i18n.t('common.close')" @click="open = false">
              <KlIcon name="close" :size="14" />
            </button>
          </template>
        </AgentChat>
      </div>
    </Transition>
    <button v-if="!open" type="button" class="kl-widget__launcher" @click="open = true">
      <KlIcon name="sparkle" :size="18" />
      <span>{{ label ?? i18n.t("widget.launcher") }}</span>
      <span v-if="store.approvals.value.length" class="kl-widget__dot" :aria-label="i18n.t('widget.approvalWaiting')" />
    </button>
    <ToastStack @open-session="open = true" />
  </div>
</template>
