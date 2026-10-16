# @klymbak/vue

Vue 3 components for chat-native admin panels, talking to [`@klymbak/server`](../server).

| Component | Use |
|---|---|
| `AgentWorkspace` | Full screen: conversations, schedules and capabilities sidebar + chat |
| `AgentChat` | A single conversation, for a page or a panel |
| `AgentWidget` | Floating launcher + chat that drops into any existing page |
| `MessageList`, `ToolCallCard`, `ApprovalPrompt`, `SubagentTrace`, `Composer`, `ModelPicker`, `SessionList`, `SchedulePanel`, `CapabilitiesPanel`, `DataTable`, `ChartView`, `StatGrid` … | Building blocks for custom layouts |

```vue
<script setup lang="ts">
import { AgentWorkspace } from "@klymbak/vue";
import "@klymbak/vue/style.css";
</script>

<template>
  <AgentWorkspace base-url="/api/agent" :renderers="{ tools: { track_shipment: ShipmentTimeline } }" @action="onAction" />
</template>
```

- **Plugin**: `app.use(Klymbak, { baseUrl, headers })` shares one store app-wide; `useAgentStore()` exposes state and actions (`send`, `abort`, `steer`, `decide`, `openSession`, schedules…). The store is [`@klymbak/client`](../client)'s, made reactive with Vue.
- **Theming**: every colour, radius and font is a `--kl-*` CSS variable, with light, dark and `auto` modes via `theme`.
- **Extending**: `renderers.blocks` for custom UI blocks, `renderers.tools` to render a tool's result with your own component, and `@action` for UI buttons that ask your app to navigate or open a record.
- **Formatting**: `configureFormatting({ locale: "en-US" })` for money, numbers and dates.

Model output is rendered as Markdown with HTML disabled.
