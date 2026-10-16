# @klymbak/react

React components for chat-native admin panels, talking to [`@klymbak/server`](../server). React 18.2+ and 19.

| Component | Use |
|---|---|
| `AgentWorkspace` | Full screen: conversations, schedules and capabilities sidebar + chat |
| `AgentChat` | A single conversation, for a page or a panel |
| `AgentWidget` | Floating launcher + chat that drops into any existing page |
| `MessageList`, `MessageItem`, `ToolCallCard`, `ApprovalPrompt`, `SubagentTrace`, `Composer`, `ModelPicker`, `SessionList`, `SchedulePanel`, `CapabilitiesPanel`, `ToastStack`, `DataTable`, `ChartView`, `StatGrid` … | Building blocks for custom layouts |

```tsx
import { AgentChat } from "@klymbak/react";
import "@klymbak/react/style.css";

export function Assistant() {
  return <AgentChat baseUrl="/api/agent" renderers={{ tools: { track_shipment: ShipmentTimeline } }} onAction={openRecord} />;
}
```

- **Provider**: `<KlymbakProvider baseUrl headers>` shares one store with every component below it; `useAgentStore()` returns it (state and actions: `send`, `abort`, `steer`, `decide`, `openSession`…) and re-renders the caller when it changes. The store is [`@klymbak/client`](../client)'s.
- **Theming**: the same stylesheet and `--kl-*` CSS variables as `@klymbak/vue`, with light, dark and `auto` modes via `theme`.
- **Page context**: `<AgentChat context="Order #1042 is open">` tells the model what the person is looking at, with every message and never in the transcript (`store.setContext()` does the same without the component).
- **Extending**: `renderers.blocks` for custom UI blocks, `renderers.tools` to render a tool's result with your own component, and `onAction` for UI buttons that ask your app to navigate or open a record. Vue's slots are props here: `headerStart`, `headerEnd` and `empty` on `AgentChat`; `brand`, `sidebarFooter` and `headerEnd` on `AgentWorkspace`.
- **Formatting**: `configureFormatting({ locale: "en-US" })` for money, numbers and dates.
- **Rendering**: messages are mutated in place while they stream, so `MessageList` memoizes each one on its store revision: a long conversation only re-renders the message that is changing. Don't wrap components that take a message or a tool part in `React.memo`.

`apps/react-console` is a playground against the Acme demo API: `pnpm dev:react`, then open <http://localhost:5175>.
