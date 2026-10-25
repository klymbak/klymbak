# @klymbak/server

Agent harness for chat-native admin panels, built on the [pi](https://github.com/earendil-works/pi) agent loop.

- **Tools** with typed parameters, roles, approvals and generative UI output (`defineTool`, `ui`)
- **MCP servers** over stdio or Streamable HTTP, with annotations honoured; their resources and resource templates can be mentioned with `@` in the chat and their prompts started with `/`, with values suggested through MCP completions, and the model reads resources with `list_resources` and `read_resource`
- **Hooks** modelled on Claude Code: `sessionStart`, `userPromptSubmit`, `preToolUse`, `postToolUse`, `stop`, `runEnd`, `onEvent`
- **Human approvals** with deny reasons, "always allow" and expiry; in unattended runs they wait, stored with the session, and the decision resumes the run, the approved call acting as whoever approved it. Text arguments a person may edit first, such as a drafted reply (`edit`), and an approval inbox per person (`GET /approvals`, `listApprovals`)
- **Subagents** via a `delegate_task` tool, streamed as nested transcripts
- **Skills** in Anthropic's `SKILL.md` format (`loadSkills`): procedures and house rules, loaded with a `use_skill` tool when a task calls for them
- **Knowledge** (`knowledgeTools`): folders of Markdown, HTML and PDF, llms.txt sites, sitemaps, your own documents, resolved tickets with customers' details removed, and CSV or Excel tables looked up by column, searched section by section and cited in a `sources` block; optional semantic search through any OpenAI-compatible embeddings endpoint (`openAIEmbeddings`). PDFs need the `unpdf` package
- **Scheduled tasks** (cron) that run unattended and notify their audience
- **Jobs from your own code** (`runHeadless`): pending tasks and background work that run unattended, with context for the model only
- **Any model**: every pi-ai provider plus OpenAI-compatible endpoints (`lmStudio()`, `ollama()`, `openAICompatible()`)
- **People's languages**: tool names, approvals, refusals, notices and errors in each person's language (`ctx.user.locale`, from `Accept-Language`), with `createTranslator` for a tool's own text. Built-in text ships in 12 languages besides English; what the model reads stays English
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
