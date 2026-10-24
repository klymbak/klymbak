import { computed, inject, provide, shallowRef, type App, type Component, type InjectionKey, type Ref } from "vue";
import type { ToolPart, UiAction } from "@klymbak/protocol";
import { createAgentClient, createI18n, type AgentClientOptions, type I18n, type Messages } from "@klymbak/client";
import { createAgentStore, type AgentStore } from "./store";

/** Host-app extensions: custom UI blocks and per-tool result renderers. */
export interface KlymbakRenderers {
  /** Components for `{ type: "custom", component: name }` UI blocks. They receive the block's props. */
  blocks?: Record<string, Component>;
  /** Replaces the result area of a tool card. Receives `{ part: ToolPart }`. */
  tools?: Record<string, Component>;
}

export interface ChatActions {
  sendPrompt(text: string): void;
  emitAction(action: UiAction): void;
}

const STORE: InjectionKey<AgentStore> = Symbol("klymbak-store");
const RENDERERS: InjectionKey<KlymbakRenderers> = Symbol("klymbak-renderers");
const ACTIONS: InjectionKey<ChatActions> = Symbol("klymbak-actions");
const ROOT: InjectionKey<boolean> = Symbol("klymbak-root");
const I18N: InjectionKey<Readonly<Ref<I18n>>> = Symbol("klymbak-i18n");
const english = shallowRef(createI18n());

export interface I18nSource {
  /** The interface language, a BCP 47 tag such as "fr". Numbers and dates follow it too. */
  locale?: string;
  /**
   * Messages in that language, e.g. the default export of `@klymbak/client/locales/fr`, or a few of your own.
   * They go over the inherited ones, and anything missing is shown in English.
   */
  messages?: Partial<Messages>;
}

/** An I18n that reads the ref on every call, so a template that uses it renders again when the language changes. */
function delegate(source: Readonly<Ref<I18n>>): I18n {
  return {
    get locale() {
      return source.value.locale;
    },
    get messages() {
      return source.value.messages;
    },
    t: (id, values) => source.value.t(id, values),
    parts: (id, values) => source.value.parts(id, values),
    text: (value) => source.value.text(value),
    number: (value) => source.value.number(value),
    formatValue: (value, format, currencyCode) => source.value.formatValue(value, format, currencyCode),
    compactNumber: (value, format, currencyCode) => source.value.compactNumber(value, format, currencyCode),
    timeAgo: (value) => source.value.timeAgo(value),
    describeCron: (expression) => source.value.describeCron(expression),
    duration: (ms) => source.value.duration(ms),
  };
}

/** The words, numbers and dates of the plugin or the nearest top-level component: English by default. */
export function useI18n(): I18n {
  return delegate(inject(I18N, english));
}

/** Gives the components below a `locale` and `messages` over the inherited ones (both may change), and returns the result. */
export function provideI18n(source: () => I18nSource): I18n {
  const inherited = inject(I18N, english);
  const resolved = computed(() => {
    const { locale, messages } = source();
    const base = inherited.value;
    if (locale === undefined && !messages) return base;
    return createI18n({ locale: locale ?? base.locale, messages: messages ? { ...base.messages, ...messages } : base.messages });
  });
  provide(I18N, resolved);
  return delegate(resolved);
}

/** Marks a subtree as already inside a themed .kl-root, so nested components don't re-theme. */
export function provideRoot() {
  provide(ROOT, true);
}

export function useInsideRoot(): boolean {
  return inject(ROOT, false);
}

export function provideAgentStore(store: AgentStore) {
  provide(STORE, store);
}

/** The store provided by the plugin or the nearest <AgentWorkspace>/<AgentChat>. */
export function useAgentStore(): AgentStore {
  const store = inject(STORE, null);
  if (!store) {
    throw new Error("No agent store found. Install the Klymbak plugin or pass `:store`/`base-url` to the component.");
  }
  return store;
}

export function useOptionalAgentStore(): AgentStore | null {
  return inject(STORE, null);
}

export function provideRenderers(renderers: KlymbakRenderers) {
  provide(RENDERERS, renderers);
}

export function useRenderers(): KlymbakRenderers {
  return inject(RENDERERS, {});
}

export function provideChatActions(actions: ChatActions) {
  provide(ACTIONS, actions);
}

export function useChatActions(): ChatActions {
  return inject(ACTIONS, { sendPrompt: () => undefined, emitAction: () => undefined });
}

export interface KlymbakPluginOptions extends AgentClientOptions, I18nSource {
  renderers?: KlymbakRenderers;
  /** Load config and sessions immediately. Default true. */
  autoInit?: boolean;
}

/**
 * app.use(Klymbak, { baseUrl: "/api/agent" }) provides one shared store to every
 * component in the app. Components also work without the plugin when given a base URL.
 */
export const Klymbak = {
  install(app: App, options: KlymbakPluginOptions) {
    const store = createAgentStore({ client: createAgentClient({ ...options, locale: options.locale ?? "en" }) });
    app.provide(STORE, store);
    app.provide(RENDERERS, options.renderers ?? {});
    if (options.locale !== undefined || options.messages) app.provide(I18N, shallowRef(createI18n({ locale: options.locale, messages: options.messages })));
    app.config.globalProperties.$agent = store;
    if (options.autoInit !== false) void store.init();
  },
};

export type { ToolPart };
