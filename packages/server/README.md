# @klymbak/server

Agent harness for chat-native admin panels, built on the [pi](https://github.com/earendil-works/pi) agent loop.

- **Tools** with typed parameters, roles, approvals and generative UI output (`defineTool`, `ui`)
- **MCP servers** over stdio or Streamable HTTP, with annotations honoured
- **Hooks** modelled on Claude Code: `sessionStart`, `userPromptSubmit`, `preToolUse`, `postToolUse`, `stop`, `runEnd`, `onEvent`
- **Human approvals** with deny reasons, "always allow" and expiry; refused automatically in unattended runs
- **Subagents** via a `delegate_task` tool, streamed as nested transcripts
- **Scheduled tasks** (cron) that run unattended and notify their audience
- **Any model**: every pi-ai provider plus OpenAI-compatible endpoints (`lmStudio()`, `ollama()`, `openAICompatible()`)
- **Sessions, steering, context-window management** and an **HTTP + SSE API** (`createAgentServer`), mountable in Hono, Express or any fetch runtime

```ts
import { createAgentServer, defineTool, Type } from "@klymbak/server";

const agent = createAgentServer({
  systemPrompt: "You are the back-office agent for …",
  models: { providers: ["anthropic"], default: "anthropic/claude-sonnet-5-5" },
  tools: [
    defineTool({
      name: "get_order",
      description: "Look up an order by id",
      readOnly: true,
      parameters: Type.Object({ id: Type.Integer() }),
      execute: async ({ id }) => JSON.stringify(await db.orders.get(id)),
    }),
  ],
  auth: (request) => sessions.userFrom(request),
});

expressApp.use("/api/agent", agent.nodeHandler);
```

Without HTTP, use `createAgentRuntime(config)` directly (`startRun`, `attach`, `decide`, `runHeadless`…).

See the [repository README](../../README.md) for the full guide.
