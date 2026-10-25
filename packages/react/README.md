# @klymbak/react

React components for chat-native admin panels, talking to [`@klymbak/server`](../server). React 18.2+ and 19.

| Component | Use |
|---|---|
| `AgentWorkspace` | Full screen: conversations, schedules and capabilities sidebar + chat, and the approval inbox while approvals wait |
| `AgentChat` | A single conversation, for a page or a panel |
| `AgentWidget` | Floating launcher + chat that drops into any existing page |
| `ApprovalInbox` | What unattended runs left waiting for the signed-in person, across conversations: approve, deny with a reason, or edit a drafted reply first |
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
- **Extending**: `renderers.blocks` for custom UI blocks, `renderers.tools` to render a tool's result with your own component, and `onAction` for UI buttons that ask your app to navigate or open a record. Vue's slots are props here: `headerStart`, `headerEnd` and `empty` on `AgentChat`; `headerStart` and `headerEnd` on `ApprovalInbox`; `brand`, `sidebarFooter` and `headerEnd` on `AgentWorkspace`.
- **Language**: English by default. `locale` and `messages` on `KlymbakProvider` or a top-level component put the words, numbers and dates into another language: `import fr from "@klymbak/client/locales/fr"`, then `<AgentWorkspace locale="fr" messages={fr} />`. Messages a catalog leaves out stay English, so `messages={{ ...fr, "chat.newChat": "Nouvelle question" }}` changes one string. `loadMessages(tag)` picks and loads the closest catalog at runtime, and `useI18n()` gives your own components the same formatting. `title` and `description` replace the server's app name and welcome text. The server writes tool names, approvals and notices in the same language (see [Languages](../../README.md#languages)). See [`@klymbak/client`](../client#languages) for the languages and the message format.
- **Rendering**: messages are mutated in place while they stream, so `MessageList` memoizes each one on its store revision: a long conversation only re-renders the message that is changing. Don't wrap components that take a message or a tool part in `React.memo`.

`apps/react-console` is a playground against the Acme demo API: `pnpm dev:react`, then open <http://localhost:5175>.
