import { isPlatformBrowser } from "@angular/common";
import {
  DestroyRef,
  Directive,
  InjectionToken,
  PLATFORM_ID,
  afterNextRender,
  computed,
  inject,
  input,
  signal,
  type Provider,
  type Signal,
  type Type,
} from "@angular/core";
import type { UiAction } from "@klymbak/protocol";
import { createAgentClient, createAgentStore, type AgentClientOptions, type AgentState, type AgentStore } from "@klymbak/client";

/** Host-app extensions: custom UI blocks and per-tool result renderers. */
export interface KlymbakRenderers {
  /** Components for `{ type: "custom", component: name }` UI blocks. Each of the block's props goes to the input of that name. */
  blocks?: Record<string, Type<unknown>>;
  /** Replaces the result area of a tool card. The component gets the tool call as its `part` input. */
  tools?: Record<string, Type<unknown>>;
}

export interface ChatActions {
  sendPrompt(text: string): void;
  emitAction(action: UiAction): void;
}

/**
 * Returns the store for the components below. Called when the store is first needed, not at injection:
 * a component that gets its store from its inputs knows it only once they are set.
 */
type StoreRef = () => AgentStore;

const STORE = new InjectionToken<StoreRef>("klymbak store");
export const RENDERERS = new InjectionToken<Signal<KlymbakRenderers>>("klymbak renderers", { factory: () => signal({}) });
export const CHAT_ACTIONS = new InjectionToken<ChatActions>("klymbak chat actions", {
  factory: () => ({ sendPrompt: () => undefined, emitAction: () => undefined }),
});
/** True inside a themed .kl-root, so nested components don't re-theme. */
export const INSIDE_ROOT = new InjectionToken<boolean>("klymbak root", { factory: () => false });

const states = new WeakMap<AgentStore, Signal<Readonly<AgentState>>>();

/**
 * The store's state as a signal that changes whenever the state does. Objects keep their identity while they
 * change in place, so derive values from what you read rather than comparing objects.
 */
export function agentState(store: AgentStore): Signal<Readonly<AgentState>> {
  let state = states.get(store);
  if (!state) {
    const version = signal(store.getVersion());
    store.subscribe(() => version.set(store.getVersion()));
    state = computed(() => (version(), store.state), { equal: () => false });
    states.set(store, state);
  }
  return state;
}

/** The nearest store, resolved when first called. For the building blocks, which may be created before their host has its inputs. */
export function injectStoreRef(): StoreRef {
  const ref = inject(STORE, { optional: true });
  return ref ?? missingStore;
}

export function injectOptionalStoreRef(): StoreRef | null {
  return inject(STORE, { optional: true });
}

function missingStore(): never {
  throw new Error("No agent store found. Add provideKlymbak() to the app's providers, or pass `store`/`baseUrl` to the component.");
}

/** The store from the nearest provideKlymbak() or Klymbak component. Call it in an injection context. */
export function injectAgentStore(): AgentStore {
  return injectStoreRef()();
}

/** The nearest store's state, as a signal that changes whenever the state does. Call it in an injection context. */
export function injectAgentState(): Signal<Readonly<AgentState>> {
  const ref = injectStoreRef();
  return computed(() => agentState(ref())(), { equal: () => false });
}

export function injectRenderers(): Signal<KlymbakRenderers> {
  return inject(RENDERERS);
}

export function injectChatActions(): ChatActions {
  return inject(CHAT_ACTIONS);
}

/** Shares an existing store with the components below. */
export function provideAgentStore(store: AgentStore): Provider {
  return { provide: STORE, useValue: () => store };
}

export interface KlymbakOptions extends AgentClientOptions {
  renderers?: KlymbakRenderers;
  /** Load config and sessions as soon as the store is created. Default true. */
  autoInit?: boolean;
}

/**
 * Shares one store with every Klymbak component in the app (in `bootstrapApplication`'s providers) or below a
 * component (in its `providers`), like the Vue plugin. Components also work without it when given a `baseUrl`.
 */
export function provideKlymbak({ renderers, autoInit = true, ...options }: KlymbakOptions): Provider[] {
  const providers: Provider[] = [
    {
      provide: STORE,
      useFactory: (): StoreRef => {
        const store = createAgentStore({ client: createAgentClient(options) });
        inject(DestroyRef).onDestroy(() => store.dispose());
        if (autoInit && isPlatformBrowser(inject(PLATFORM_ID))) void store.init();
        return () => store;
      },
    },
  ];
  if (renderers) {
    providers.push({
      provide: RENDERERS,
      useFactory: () => {
        const inherited = inject(RENDERERS, { skipSelf: true, optional: true });
        return computed(() => mergeRenderers(inherited?.() ?? {}, renderers));
      },
    });
  }
  return providers;
}

export function mergeRenderers(base: KlymbakRenderers, extra: KlymbakRenderers | undefined): KlymbakRenderers {
  if (!extra) return base;
  return { blocks: { ...base.blocks, ...extra.blocks }, tools: { ...base.tools, ...extra.tools } };
}

/**
 * The inputs and store of a top-level component (AgentChat, AgentWorkspace, AgentWidget): its `store` input,
 * the nearest provided store, or one it creates from `baseUrl` and owns. The store is fixed once first used.
 */
@Directive()
export abstract class StoreHost {
  /** Use an existing store. Otherwise the nearest provided one is used, or one is created from `baseUrl`. */
  readonly storeInput = input<AgentStore | undefined>(undefined, { alias: "store" });
  readonly baseUrl = input<string>();
  readonly headers = input<AgentClientOptions["headers"]>();
  readonly credentials = input<RequestCredentials>();
  readonly fetch = input<typeof globalThis.fetch>();
  readonly renderers = input<KlymbakRenderers>();

  protected abstract readonly tag: string;
  private readonly inherited = inject(STORE, { optional: true, skipSelf: true });
  private readonly inheritedRenderers = inject(RENDERERS, { skipSelf: true });
  private resolved?: { store: AgentStore; owned: boolean };

  /** Its renderers over the inherited ones, for the components inside it. */
  readonly mergedRenderers = computed(() => mergeRenderers(this.inheritedRenderers(), this.renderers()));

  constructor() {
    afterNextRender(() => {
      const { store, owned } = this.resolve();
      if (owned || !store.state.ready) void store.init();
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.resolved?.owned) this.resolved.store.dispose();
    });
  }

  /** The store this component and the ones inside it work with. */
  get store(): AgentStore {
    return this.resolve().store;
  }

  private resolve() {
    if (!this.resolved) {
      const store = this.storeInput() ?? this.inherited?.();
      const baseUrl = this.baseUrl();
      if (store) this.resolved = { store, owned: false };
      else if (baseUrl) {
        const client = createAgentClient({ baseUrl, headers: this.headers(), credentials: this.credentials(), fetch: this.fetch() });
        this.resolved = { store: createAgentStore({ client }), owned: true };
      } else throw new Error(`<${this.tag}> needs a \`store\`, provideKlymbak(), or a \`baseUrl\`.`);
    }
    return this.resolved;
  }
}

/** What a top-level component gives the components inside it. Listed after `{ provide: StoreHost, useExisting: … }`. */
export const HOST_PROVIDERS: Provider[] = [
  {
    provide: STORE,
    useFactory: (): StoreRef => {
      const host = inject(StoreHost, { self: true });
      return () => host.store;
    },
  },
  { provide: RENDERERS, useFactory: () => inject(StoreHost, { self: true }).mergedRenderers },
  { provide: INSIDE_ROOT, useValue: true },
];
