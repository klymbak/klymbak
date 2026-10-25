<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from "vue";
import { createAgentClient, type AgentClientOptions, type Messages } from "@klymbak/client";
import { provideAgentStore, provideI18n, provideRoot, useInsideRoot, useOptionalAgentStore } from "../context";
import { createAgentStore, type AgentStore } from "../store";
import ApprovalPrompt from "./ApprovalPrompt.vue";
import KlIcon from "./KlIcon.vue";
import ToastStack from "./ToastStack.vue";

/**
 * The approval inbox: what unattended runs left waiting, across conversations, for the signed-in person to approve,
 * deny with a reason, or edit first. The server lists only what their roles let them decide, oldest first.
 */
const props = withDefaults(
  defineProps<{
    /** Use an existing store. Otherwise one is injected or created from baseUrl. */
    store?: AgentStore;
    baseUrl?: string;
    headers?: AgentClientOptions["headers"];
    /** The interface language, a BCP 47 tag such as "fr". Numbers and dates follow it too. */
    locale?: string;
    /** Messages in that language, e.g. the default export of `@klymbak/client/locales/fr`. Missing ones are shown in English. */
    messages?: Partial<Messages>;
    theme?: "auto" | "light" | "dark";
  }>(),
  { theme: "auto" },
);
/** An item's conversation was opened in the store, for the host to show it. */
const emit = defineEmits<{ openSession: [id: string] }>();

defineSlots<{
  "header-start"?: () => unknown;
  "header-end"?: () => unknown;
}>();

const injected = useOptionalAgentStore();
const owned = !props.store && !injected;
if (owned && !props.baseUrl) throw new Error("<ApprovalInbox> needs a `store`, the Klymbak plugin, or a `base-url`.");
const store: AgentStore =
  props.store ?? injected ?? createAgentStore({ client: createAgentClient({ baseUrl: props.baseUrl!, headers: props.headers }) });
if (!injected || props.store) provideAgentStore(store);

const insideRoot = useInsideRoot();
if (!insideRoot) provideRoot();

const i18n = provideI18n(() => ({ locale: props.locale, messages: props.messages }));
// The server writes approval titles in this language. Set before init, so the first requests ask for it.
watch(() => i18n.locale, (locale) => store.setLocale(locale ?? "en"), { immediate: true });

onMounted(() => {
  if (owned || !store.state.ready) void store.init();
  // The store keeps it current; catch up in case this shows long after the store loaded.
  else void store.refreshInbox();
});
onBeforeUnmount(() => {
  if (owned) store.dispose();
});

const state = store.state;
const sourceIcons = { schedule: "clock", api: "sparkle", chat: "chat" } as const;

function open(sessionId: string) {
  void store.openSession(sessionId);
  emit("openSession", sessionId);
}
</script>

<template>
  <section class="kl-inbox" :class="{ 'kl-root': !insideRoot }" :data-kl-theme="insideRoot ? undefined : theme" :aria-label="i18n.t('inbox.title')">
    <header class="kl-inbox__header">
      <slot name="header-start" />
      <h2 class="kl-inbox__title">{{ i18n.t("inbox.title") }}</h2>
      <span v-if="state.inbox.length" class="kl-pill kl-tone-warning">{{ i18n.number(state.inbox.length) }}</span>
      <slot name="header-end" />
    </header>
    <div class="kl-inbox__body kl-scroll">
      <div class="kl-inbox__list">
        <p v-if="state.inbox.length" class="kl-inbox__intro">{{ i18n.t("inbox.intro") }}</p>
        <p v-else class="kl-inbox__empty"><KlIcon name="shield" :size="22" />{{ i18n.t("inbox.empty") }}</p>
        <article v-for="item in state.inbox" :key="item.approval.id" class="kl-inbox__item">
          <div class="kl-inbox__meta">
            <button type="button" class="kl-inbox__session" :title="i18n.t('inbox.open')" @click="open(item.sessionId)">
              <KlIcon :name="sourceIcons[item.source]" :size="13" />
              <span>{{ item.sessionTitle }}</span>
            </button>
            <span>{{ i18n.t(`inbox.source.${item.source}`) }} · {{ i18n.timeAgo(item.createdAt) }}</span>
          </div>
          <ApprovalPrompt :approval="item.approval" :session-id="item.sessionId" />
        </article>
      </div>
    </div>
    <!-- On its own, it shows why a decision didn't go through; inside the workspace, the workspace does. -->
    <ToastStack v-if="!insideRoot" @open-session="emit('openSession', $event)" />
  </section>
</template>
