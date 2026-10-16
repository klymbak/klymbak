# @klymbak/client

The framework-agnostic browser side of a Klymbak chat, shared by [`@klymbak/vue`](../vue) and any other UI binding:

- `createAgentClient(options)`: typed client for the [`@klymbak/server`](../server) HTTP + SSE API
- `createAgentStore({ client })`: config, sessions, the open conversation, schedules and toasts, with every action (`send`, `steer`, `abort`, `decide`, `openSession`, schedules…)
- `subscribe(listener)` and `getVersion()`: change notifications for frameworks without deep reactivity
- Selectors: `selectModels`, `selectCurrentModel`, `selectApprovals`, `selectCurrentSession`, `selectUnreadCount`
- Formatting (`formatValue`, `describeCron`, `timeAgo`, `configureFormatting`…) and `renderMarkdown`, which escapes HTML in model output and loads images only from the page's own origin (others become links, so an injected prompt can't leak data through an image URL)
- `@klymbak/client/style.css`: the stylesheet every binding renders with: the `--kl-*` theme in `styles/base.css`, then one file per component. Bindings bundle it into their own `style.css`.

```ts
import { createAgentClient, createAgentStore, selectApprovals } from "@klymbak/client";

const store = createAgentStore({ client: createAgentClient({ baseUrl: "/api/agent" }) });
store.subscribe(() => render(store.state, selectApprovals(store.state)));
await store.init();
await store.send("Which products are about to run out?");
```

## Change tracking

The transcript reducer from `@klymbak/protocol` updates messages in place. By default the store wraps its state in a proxy that records every write: `getVersion()` grows with each one, and subscribers hear about it once per batch of synchronous writes. In React:

```ts
const version = useSyncExternalStore(store.subscribe, store.getVersion);
```

Objects keep their identity when they change, so memoize on the version, not on `state.messages` or a message object. To re-render one message at a time, memoize on the message plus `getMessageRevision(message.id)`, which grows each time a stream event changes that message; `@klymbak/react`'s `MessageList` does this.

A framework with deep reactivity passes its own wrapper and tracks changes itself; `subscribe` then stays silent. This is what `@klymbak/vue` does:

```ts
createAgentStore({ client, reactive: (state) => reactive(state) as typeof state });
```
