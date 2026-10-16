import { computed, reactive } from "vue";
import {
  createAgentStore as createClientStore,
  selectApprovals,
  selectCurrentModel,
  selectCurrentSession,
  selectModels,
  selectUnreadCount,
  type AgentStoreOptions as ClientStoreOptions,
} from "@klymbak/client";

export type AgentStoreOptions = Omit<ClientStoreOptions, "reactive">;

export type AgentStore = ReturnType<typeof createAgentStore>;

/**
 * The @klymbak/client store made reactive with Vue, plus computed views of it.
 * Components share it through provide/inject.
 */
export function createAgentStore(options: AgentStoreOptions) {
  const store = createClientStore({ ...options, reactive: (state) => reactive(state) as typeof state });
  return {
    ...store,
    models: computed(() => selectModels(store.state)),
    currentModel: computed(() => selectCurrentModel(store.state)),
    approvals: computed(() => selectApprovals(store.state)),
    currentSession: computed(() => selectCurrentSession(store.state)),
    unreadCount: computed(() => selectUnreadCount(store.state)),
  };
}
