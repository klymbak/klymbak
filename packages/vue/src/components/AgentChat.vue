<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { UiAction } from "@klymbak/protocol";
import { createAgentClient, type AgentClientOptions, type Attachment, type Messages } from "@klymbak/client";
import {
  provideAgentStore,
  provideChatActions,
  provideI18n,
  provideRenderers,
  provideRoot,
  useInsideRoot,
  useOptionalAgentStore,
  useRenderers,
  type KlymbakRenderers,
} from "../context";
import { createAgentStore, type AgentStore } from "../store";
import Composer from "./Composer.vue";
import MessageList from "./MessageList.vue";
import ModelPicker from "./ModelPicker.vue";
import KlIcon from "./KlIcon.vue";

const props = withDefaults(
  defineProps<{
    /** Use an existing store. Otherwise one is injected or created from baseUrl. */
    store?: AgentStore;
    baseUrl?: string;
    headers?: AgentClientOptions["headers"];
    title?: string;
    /** Text under the title on the welcome screen. Defaults to the server's app.description. */
    description?: string;
    /** Starter prompts for an empty conversation. Defaults to the server's app.suggestions. */
    suggestions?: string[];
    placeholder?: string;
    /** The interface language, a BCP 47 tag such as "fr". Numbers and dates follow it too. */
    locale?: string;
    /** Messages in that language, e.g. the default export of `@klymbak/client/locales/fr`. Missing ones are shown in English. */
    messages?: Partial<Messages>;
    theme?: "auto" | "light" | "dark";
    renderers?: KlymbakRenderers;
    showHeader?: boolean;
    /** Show model, tokens and cost under each answer. */
    showMeta?: boolean;
    /** What the person has open (the record on screen, the selected rows). Sent to the model only. */
    context?: string;
  }>(),
  { showHeader: true, showMeta: false, theme: "auto" },
);

const emit = defineEmits<{
  /** A UI block asked the host app to do something (kind: "event"). */
  action: [action: UiAction];
}>();

defineSlots<{
  "header-start"?: () => unknown;
  "header-end"?: () => unknown;
  empty?: () => unknown;
}>();

const injected = useOptionalAgentStore();
const owned = !props.store && !injected;
if (owned && !props.baseUrl) throw new Error("<AgentChat> needs a `store`, the Klymbak plugin, or a `base-url`.");
const store: AgentStore =
  props.store ?? injected ?? createAgentStore({ client: createAgentClient({ baseUrl: props.baseUrl!, headers: props.headers }) });
if (!injected || props.store) provideAgentStore(store);

const inheritedRenderers = useRenderers();
if (props.renderers) provideRenderers({ blocks: { ...inheritedRenderers.blocks, ...props.renderers.blocks }, tools: { ...inheritedRenderers.tools, ...props.renderers.tools } });

const insideRoot = useInsideRoot();
if (!insideRoot) provideRoot();

const i18n = provideI18n(() => ({ locale: props.locale, messages: props.messages }));
// The server writes tool labels, approvals and notices in this language. Set before init, so the first requests ask for it.
watch(() => i18n.locale, (locale) => store.setLocale(locale ?? "en"), { immediate: true });

const composer = ref<InstanceType<typeof Composer>>();

provideChatActions({
  sendPrompt: (text) => void store.send(text),
  emitAction: (action) => emit("action", action),
});

onMounted(() => {
  if (owned || !store.state.ready) void store.init();
});
watch(
  () => props.context,
  (context, previous) => {
    if (context !== undefined || previous !== undefined) store.setContext(context);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  if (props.context !== undefined) store.setContext(undefined);
  if (owned) store.dispose();
});

const state = store.state;
const suggestions = computed(() => props.suggestions ?? state.config?.app.suggestions ?? []);
const heading = computed(() => props.title ?? state.config?.app.name ?? i18n.t("chat.defaultTitle"));
const description = computed(() => props.description ?? state.config?.app.description);
const sessionTitle = computed(() => store.currentSession.value?.title);
const acceptImages = computed(() => Boolean(store.currentModel.value?.input.includes("image")));

function send(text: string, attachments: Attachment[]) {
  void store.send(text, attachments);
}

function useSuggestion(text: string) {
  void store.send(text);
}

defineExpose({ store, focus: () => composer.value?.focus(), setDraft: (text: string) => composer.value?.setText(text) });
</script>

<template>
  <section class="kl-chat" :class="{ 'kl-root': !insideRoot }" :data-kl-theme="insideRoot ? undefined : theme" :aria-label="i18n.t('chat.label')">
    <header v-if="showHeader" class="kl-chat__header">
      <slot name="header-start" />
      <div class="kl-chat__titles">
        <span class="kl-chat__title">{{ sessionTitle ?? heading }}</span>
        <span v-if="sessionTitle" class="kl-chat__subtitle">{{ heading }}</span>
      </div>
      <span v-if="state.running" class="kl-chat__status"><span class="kl-spinner" /> {{ i18n.t("chat.working") }}</span>
      <slot name="header-end" />
      <button type="button" class="kl-btn kl-btn--sm" :disabled="!state.sessionId" @click="store.newSession()">
        <KlIcon name="plus" :size="14" /> {{ i18n.t("chat.newChat") }}
      </button>
    </header>

    <div v-if="state.error" class="kl-chat__fatal">
      <KlIcon name="alert" :size="18" />
      <div>
        <strong>{{ i18n.t("chat.unreachable") }}</strong>
        <p>{{ i18n.text(state.error) }}</p>
        <button type="button" class="kl-btn kl-btn--sm" @click="store.init()">{{ i18n.t("chat.retry") }}</button>
      </div>
    </div>

    <MessageList v-else :messages="state.messages" :running="state.running" :show-meta="showMeta">
      <template #empty>
        <slot name="empty">
          <div v-if="!state.loadingSession" class="kl-welcome">
            <span class="kl-welcome__mark"><KlIcon name="sparkle" :size="20" /></span>
            <h2 class="kl-welcome__title">{{ heading }}</h2>
            <p v-if="description" class="kl-welcome__text">{{ description }}</p>
            <div v-if="suggestions.length" class="kl-welcome__suggestions">
              <button v-for="suggestion in suggestions" :key="suggestion" type="button" class="kl-welcome__suggestion" @click="useSuggestion(suggestion)">
                {{ suggestion }}
              </button>
            </div>
          </div>
        </slot>
      </template>
    </MessageList>

    <div class="kl-chat__footer">
      <div v-if="state.runError" class="kl-chat__error" role="alert">
        <KlIcon name="alert" :size="14" /> {{ i18n.text(state.runError) }}
      </div>
      <Composer
        ref="composer"
        :running="state.running"
        :disabled="!state.ready"
        :placeholder="placeholder"
        :accept-images="acceptImages && state.config?.features.attachments"
        @send="send"
        @stop="store.abort()"
      >
        <template #tools>
          <ModelPicker />
        </template>
      </Composer>
    </div>
  </section>
</template>
