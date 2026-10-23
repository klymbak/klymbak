import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import type { ToolPart, UiAction } from "@klymbak/protocol";
import { createAgentClient, createAgentStore, createI18n, type AgentClientOptions, type AgentStore, type I18n, type Messages } from "@klymbak/client";

/** Host-app extensions: custom UI blocks and per-tool result renderers. */
export interface KlymbakRenderers {
  /** Components for `{ type: "custom", component: name }` UI blocks. They receive the block's props. */
  blocks?: Record<string, ComponentType<any>>;
  /** Replaces the result area of a tool card. */
  tools?: Record<string, ComponentType<{ part: ToolPart }>>;
}

export interface ChatActions {
  sendPrompt(text: string): void;
  emitAction(action: UiAction): void;
}

const StoreContext = createContext<AgentStore | null>(null);
const RenderersContext = createContext<KlymbakRenderers>({});
const ChatActionsContext = createContext<ChatActions>({ sendPrompt: () => undefined, emitAction: () => undefined });
const I18nContext = createContext<I18n>(createI18n());
/** True inside a themed .kl-root, so nested components don't re-theme. */
const RootContext = createContext(false);

export const StoreProvider = StoreContext.Provider;
export const RenderersProvider = RenderersContext.Provider;
export const ChatActionsProvider = ChatActionsContext.Provider;
export const I18nProvider = I18nContext.Provider;
export const RootProvider = RootContext.Provider;

const noSubscription = () => () => undefined;
const noVersion = () => 0;

/** Re-renders the calling component whenever the store's state changes. */
function useStoreVersion(store: AgentStore | null) {
  useSyncExternalStore(store?.subscribe ?? noSubscription, store?.getVersion ?? noVersion, store?.getVersion ?? noVersion);
}

/** The store from the nearest provider or chat. The calling component re-renders whenever its state changes. */
export function useAgentStore(): AgentStore {
  const store = useContext(StoreContext);
  useStoreVersion(store);
  if (!store) throw new Error("No agent store found. Wrap the app in <KlymbakProvider> or pass `store`/`baseUrl` to the component.");
  return store;
}

export function useOptionalAgentStore(): AgentStore | null {
  const store = useContext(StoreContext);
  useStoreVersion(store);
  return store;
}

export function useRenderers(): KlymbakRenderers {
  return useContext(RenderersContext);
}

export function useChatActions(): ChatActions {
  return useContext(ChatActionsContext);
}

/** The words, numbers and dates of the nearest provider or top-level component: English by default. */
export function useI18n(): I18n {
  return useContext(I18nContext);
}

export function useInsideRoot(): boolean {
  return useContext(RootContext);
}

export interface I18nSource {
  /** The interface language, a BCP 47 tag such as "fr". Numbers and dates follow it too. */
  locale?: string;
  /**
   * Messages in that language, e.g. the default export of `@klymbak/client/locales/fr`, or a few of your own.
   * They go over the inherited ones, and anything missing is shown in English. Keep the object stable between renders.
   */
  messages?: Partial<Messages>;
}

/** The I18n for a component with its own `locale` or `messages`, over the inherited one. */
export function useResolvedI18n({ locale, messages }: I18nSource): I18n {
  const inherited = useI18n();
  return useMemo(() => {
    if (locale === undefined && !messages) return inherited;
    return createI18n({ locale: locale ?? inherited.locale, messages: messages ? { ...inherited.messages, ...messages } : inherited.messages });
  }, [inherited, locale, messages]);
}

export interface StoreSource extends Partial<AgentClientOptions> {
  /** Use an existing store. Otherwise the provider's is used, or one is created from baseUrl. */
  store?: AgentStore;
}

/**
 * The store a top-level component works with: its `store` prop, the nearest provider's, or one it
 * creates from `baseUrl` and owns. Loads it on mount and re-renders on every change.
 */
export function useResolvedStore(source: StoreSource, component: string): AgentStore {
  const injected = useContext(StoreContext);
  const [created] = useState(() => {
    if (source.store || injected || !source.baseUrl) return null;
    const { baseUrl, headers, credentials, fetch } = source;
    return createAgentStore({ client: createAgentClient({ baseUrl, headers, credentials, fetch }) });
  });
  const store = source.store ?? injected ?? created;
  if (!store) throw new Error(`<${component}> needs a \`store\`, a <KlymbakProvider>, or a \`baseUrl\`.`);
  const owned = store === created;

  useEffect(() => {
    if (owned || !store.state.ready) void store.init();
    return () => {
      if (owned) store.dispose();
    };
  }, [store, owned]);

  useStoreVersion(store);
  return store;
}

export interface KlymbakProviderProps extends StoreSource, I18nSource {
  renderers?: KlymbakRenderers;
  children?: ReactNode;
}

/**
 * Shares one store with every Klymbak component below it, like the Vue plugin. Components also
 * work without it when given a `baseUrl`.
 */
export function KlymbakProvider({ renderers, locale, messages, children, ...source }: KlymbakProviderProps) {
  const store = useResolvedStore(source, "KlymbakProvider");
  const inherited = useRenderers();
  const i18n = useResolvedI18n({ locale, messages });
  return (
    <StoreProvider value={store}>
      <RenderersProvider value={renderers ? mergeRenderers(inherited, renderers) : inherited}>
        <I18nProvider value={i18n}>{children}</I18nProvider>
      </RenderersProvider>
    </StoreProvider>
  );
}

export function mergeRenderers(base: KlymbakRenderers, extra: KlymbakRenderers): KlymbakRenderers {
  return { blocks: { ...base.blocks, ...extra.blocks }, tools: { ...base.tools, ...extra.tools } };
}
