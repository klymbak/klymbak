import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import type { ToolPart, UiAction } from "@klymbak/protocol";
import { createAgentClient, createAgentStore, type AgentClientOptions, type AgentStore } from "@klymbak/client";

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
/** True inside a themed .kl-root, so nested components don't re-theme. */
const RootContext = createContext(false);

export const StoreProvider = StoreContext.Provider;
export const RenderersProvider = RenderersContext.Provider;
export const ChatActionsProvider = ChatActionsContext.Provider;
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

export function useInsideRoot(): boolean {
  return useContext(RootContext);
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

export interface KlymbakProviderProps extends StoreSource {
  renderers?: KlymbakRenderers;
  children?: ReactNode;
}

/**
 * Shares one store with every Klymbak component below it, like the Vue plugin. Components also
 * work without it when given a `baseUrl`.
 */
export function KlymbakProvider({ renderers, children, ...source }: KlymbakProviderProps) {
  const store = useResolvedStore(source, "KlymbakProvider");
  const inherited = useRenderers();
  return (
    <StoreProvider value={store}>
      <RenderersProvider value={renderers ? mergeRenderers(inherited, renderers) : inherited}>{children}</RenderersProvider>
    </StoreProvider>
  );
}

export function mergeRenderers(base: KlymbakRenderers, extra: KlymbakRenderers): KlymbakRenderers {
  return { blocks: { ...base.blocks, ...extra.blocks }, tools: { ...base.tools, ...extra.tools } };
}
