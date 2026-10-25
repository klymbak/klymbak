---
"@klymbak/protocol": minor
"@klymbak/client": minor
"@klymbak/server": minor
"@klymbak/react": minor
"@klymbak/vue": minor
"@klymbak/angular": minor
---

MCP servers' resources and prompts come to the chat.

- Typing `@` in the message box lists the connected servers' resources and resource templates. A chosen resource shows as a chip; a template asks for a value for each variable. The server reads them when the message is sent: the model gets their contents, marked as data, and the transcript shows their names.
- Typing `/` at the start of a message lists their prompts. Choosing one asks for its arguments, and its text opens the message.
- When a server supports MCP completions, the fields for arguments and variables suggest values as people type (`POST /mcp/complete`).
- A resource that can't be read, or a missing required value, refuses the message before the run starts.
- The model reads resources itself with the new built-in tools `list_resources` and `read_resource`, and a resource link in a tool's result names its server so it can follow it. An app's own tool of the same name wins over a built-in one.
- The Tools panel lists the servers' prompts and resources.
- Everything follows the server's `roles`, and the lists stay current when a server says they changed. `resources: false` or `prompts: false` in a server's config turns them off.
- `AgentConfigInfo` has `resources`, `resourceTemplates` and `prompts`, and `RunRequest` takes `resources` (by URI, or by template and values) and `mcpPrompt`. The transcript has two new parts, `resource` and `prompt`. `@klymbak/protocol` has `expandTemplate` and the other RFC 6570 helpers.
- `store.send(text, attachments, references)` sends them and `store.completeMcp` asks for suggestions. `findMention`, `mentionOptions` and the other helpers in `@klymbak/client` build the menus and fields, and the `Composer` in each binding takes `resources`, `resourceTemplates`, `prompts` and `complete`.
