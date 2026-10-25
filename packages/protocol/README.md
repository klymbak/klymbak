# @klymbak/protocol

The wire protocol shared by `@klymbak/server` and `@klymbak/vue`, with no dependencies:

- `ChatMessage` / `MessagePart` / `ToolPart`: the rendered transcript model
- `AgentEvent`: stream events (`message_start`, `part_delta`, `tool_update`, `subagent_event`, `run_end` …) and `NotificationEvent`
- `applyEvent(messages, event)`: the reducer both sides use to build a transcript from events
- `touchedMessages(messages, event)`: which messages an event will change, for UIs that re-render one message at a time
- `UiBlock` and the `ui` builders: `table`, `stats`, `chart`, `keyValue`, `media`, `sources`, `markdown`, `alert`, `actions`, `custom`; `autoTable` and `autoMedia` build a table or a gallery from plain records
- API request/response types and a small incremental SSE parser

Any client (React, Angular, mobile, a CLI) can implement the chat by consuming these events, or build on [`@klymbak/client`](../client), which already does.
