import { inject, provide, type App, type Component, type InjectionKey } from "vue";
import type { ToolPart, UiAction } from "@klymbak/protocol";
import { createAgentClient, type AgentClientOptions } from "@klymbak/client";
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

export interface KlymbakPluginOptions extends AgentClientOptions {
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
    const store = createAgentStore({ client: createAgentClient(options) });
    app.provide(STORE, store);
    app.provide(RENDERERS, options.renderers ?? {});
    app.config.globalProperties.$agent = store;
    if (options.autoInit !== false) void store.init();
  },
};

export type { ToolPart };
