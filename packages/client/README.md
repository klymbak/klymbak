# @klymbak/client

The framework-agnostic browser side of a Klymbak chat, shared by [`@klymbak/vue`](../vue) and any other UI binding:

- `createAgentClient(options)`: typed client for the [`@klymbak/server`](../server) HTTP + SSE API
- `createAgentStore({ client })`: config, sessions, the open conversation, schedules and toasts, with every action (`send`, `steer`, `abort`, `decide`, `openSession`, schedules…)
- `subscribe(listener)` and `getVersion()`: change notifications for frameworks without deep reactivity
- Selectors: `selectModels`, `selectCurrentModel`, `selectApprovals`, `selectCurrentSession`, `selectUnreadCount`
- `createI18n({ locale, messages })`: every word the components show, with the numbers, dates and schedules around them, in one language (see [Languages](#languages))
- Formatting (`formatValue`, `describeCron`, `timeAgo`, `configureFormatting`…, in English) and `renderMarkdown`, which escapes HTML in model output and loads images only from the page's own origin (others become links, so an injected prompt can't leak data through an image URL)
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

## Languages

Every string the components show is a message in [`messages.ts`](src/messages.ts) (`en`), keyed like `chat.newChat` or `table.rows`. Catalogs for other languages ship as separate modules: German, Spanish, French, Italian, Japanese, Korean, Dutch, Polish, Brazilian Portuguese, Turkish, Ukrainian and Simplified Chinese.

```ts
import { createI18n, loadMessages } from "@klymbak/client";
import uk from "@klymbak/client/locales/uk";

const i18n = createI18n({ locale: "uk", messages: uk });
i18n.t("table.rows", { count: 21 }); // "21 рядок"

// Or pick at runtime: "de-AT" loads de, "pt" pt-BR, "zh-CN" zh-Hans; undefined means English.
const messages = await loadMessages(navigator.language);
```

- **Fallback**: a message a catalog leaves out is shown in English, so a host can pass a few of its own on top of a catalog.
- **Format**: the basics of ICU MessageFormat, like react-intl and most translation tools: `{name}`, `{count, plural, one {# row} other {# rows}}` with the language's plural rules, and `{value, select, … other {…}}`. A malformed message shows as written rather than breaking the UI.
- **Numbers and dates** follow `locale` too. Without one, components use the locale from `configureFormatting`, else the browser's.
- **The store** doesn't translate: its own toasts and errors are `Text`, either a string from the server or a `{ id, values }` message that the UI translates with `i18n.text()`.
- **The server** writes tool names, approvals, notices and errors in the language `store.setLocale(locale)` asks for, sent as `Accept-Language`. The components call it with their `locale` (English when they have none), and the Tools panel loads again when it changes. Without it, the browser's own languages go out.
- **Adding a language**: copy a catalog in `src/locales`, translate it (`satisfies Messages` makes the typecheck fail on a missing or misspelled key), and add it to `locales` in `i18n.ts`. The tests format every message of every catalog.
