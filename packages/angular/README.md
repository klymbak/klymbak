# @klymbak/angular

Angular components for chat-native admin panels, talking to [`@klymbak/server`](../server). Angular 21 and 22, standalone components with signals.

| Component | Use |
|---|---|
| `AgentWorkspace` (`<kl-agent-workspace>`) | Full screen: conversations, schedules and capabilities sidebar + chat |
| `AgentChat` (`<kl-agent-chat>`) | A single conversation, for a page or a panel |
| `AgentWidget` (`<kl-agent-widget>`) | Floating launcher + chat that drops into any existing page |
| `MessageList`, `MessageItem`, `ToolCallCard`, `ApprovalPrompt`, `SubagentTrace`, `Composer`, `ModelPicker`, `SessionList`, `SchedulePanel`, `CapabilitiesPanel`, `ToastStack`, `DataTable`, `ChartView`, `StatGrid` … | Building blocks for custom layouts |

```ts
// main.ts
bootstrapApplication(App, {
  providers: [provideKlymbak({ baseUrl: "/api/agent", renderers: { tools: { track_shipment: ShipmentTimeline } } })],
});

// app.ts
@Component({
  selector: "app-root",
  imports: [AgentChat],
  template: `<kl-agent-chat [context]="'Order #' + order().id + ' is open'" (action)="openRecord($event)" />`,
})
export class App { … }
```

```css
/* styles.css, or "styles" in angular.json */
@import "@klymbak/angular/style.css";
```

- **Store**: `provideKlymbak({ baseUrl, headers })` shares one store with every component in the app, or below a component when listed in its `providers`. Components also work without it, given a `store` or a `baseUrl`. `injectAgentStore()` returns the store and its actions (`send`, `abort`, `steer`, `decide`, `openSession`…); `injectAgentState()` returns its state as a signal, for templates and `computed`. The store is [`@klymbak/client`](../client)'s.
- **Theming**: the same stylesheet and `--kl-*` CSS variables as `@klymbak/vue` and `@klymbak/react`, with light, dark and `auto` modes via `theme`.
- **Page context**: `<kl-agent-chat context="Order #1042 is open">` tells the model what the person is looking at, with every message and never in the transcript (`store.setContext()` does the same without the component).
- **Extending**: `renderers.blocks` for custom UI blocks (each of the block's props goes to the component input of that name), `renderers.tools` to render a tool's result with your own component (it gets the tool call as its `part` input), and `(action)` for UI buttons that ask your app to navigate or open a record. Vue's slots are content marked with an attribute: `klHeaderStart`, `klHeaderEnd` and `klEmpty` in `kl-agent-chat`; `klBrand`, `klSidebarFooter` and `klHeaderEnd` in `kl-agent-workspace`.
- **Formatting**: `configureFormatting({ locale: "en-US" })` for money, numbers and dates.
- **Change detection**: the store notifies a signal, so the components need no zone.js; they are built and tested zoneless, Angular's default. Messages are mutated in place while they stream, so `MessageList` renders a message again only when its revision in the store changes. Components that take a message or a tool call use default change detection, and a tool renderer of your own should too: its `part` changes in place.

The package is compiled in partial mode, so apps link it with their own Angular version. `apps/angular-console` is a playground against the Acme demo API: `pnpm dev:angular`, then open <http://localhost:5176>.
