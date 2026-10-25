# @klymbak/strapi

An AI assistant for the **Strapi 5** admin panel. Editors ask for what they need ("which drafts are missing a description?", "write a short post about winter birdwatching in the style of our nature articles", "translate the About page into French"), and the assistant reads and changes content **as the signed-in admin, within their Strapi permissions**, stopping for approval before every change.

- **A page in the admin**: conversations, scheduled tasks and the tool list, from the main menu.
- **A side panel in the edit view**: ask about the entry that is open. When the assistant changes it, the form refreshes (or tells you to, if you have unsaved edits).
- **A bulk action in the list view**: select entries, then ask about them.
- **Acts as the person**: content tools run in-process with the admin's own role, so field-level, locale and condition-based permissions ("only entries they created") apply exactly as in the Content Manager. Role changes apply on the next tool call; deactivated admins lose access.
- **Approvals**: creating, updating, publishing, unpublishing, discarding and deleting all show an approval card with the exact action first. Nothing is published unless someone asked.
- **Knows Strapi**: every conversation starts with the facts of this project (Strapi version, development or production mode, locales, plugins, and the content types the person can read with what their role allows). Questions about Strapi itself ("how do I let Authors publish?", "why can't I add a field?") are answered from the official docs on docs.strapi.io, with a link to the page.
- **Strapi's MCP server** (optional): connect it with an admin token for the media library tools and tools other plugins register, with every non-read tool behind approval.
- **Any model**: Anthropic, OpenAI, Google, OpenRouter, Bedrock, Azure, or a local model in LM Studio or Ollama.
- **Speaks the admin's language**: the whole interface, in English and 12 more languages, follows the language each admin picks in their profile.
- Conversations and schedules are stored in Strapi's database.

Built on [`@klymbak/server`](../server) and [`@klymbak/react`](../react).

## Install

Requires Strapi 5.47 or later (tested on 5.58) and Node 22.19+.

```bash
npm install @klymbak/strapi
```

Add a model provider key to `.env` (or run LM Studio / Ollama locally):

```bash
ANTHROPIC_API_KEY=sk-ant-…
```

Configure the plugin in `config/plugins.ts`:

```ts
import { lmStudio, type KlymbakConfig } from "@klymbak/strapi";

export default ({ env }) => ({
  klymbak: {
    config: {
      models: {
        providers: ["anthropic", "openai"],
        custom: [lmStudio()], // optional: local models
        default: "anthropic/claude-sonnet-5-5",
      },
      instructions: "Our blog is written in British English. Every article needs a category and an author.",
    } satisfies KlymbakConfig,
  },
});
```

Rebuild the admin (`npm run build`, or restart `npm run develop`). Super admins see **Assistant** in the main menu straight away. For other roles, open **Settings → Administration panel → Roles**, pick the role, and tick **Use the assistant** under **Plugins → Klymbak**.

## What the assistant can do

With the default content tools it works with every content type shown in the Content Manager:

| Tool | Does | Approval |
|---|---|---|
| `list_content_types`, `describe_content_type` | Learns the content model: fields, components, relations, and what the person's role allows | no |
| `find_entries` | Lists entries with Strapi filters, sorting and paging (draft or published) | no |
| `get_entry` | Reads one entry in full, including components and dynamic zones, and shows its images | no |
| `create_entry`, `update_entry` | Writes drafts; rich text as Markdown (converted for Blocks fields), relations by documentId | yes |
| `publish_entry`, `unpublish_entry`, `discard_draft` | Draft & Publish | yes |
| `delete_entry` | Deletes an entry or one locale of it | yes, high risk |
| `upload_media` | Uploads an image attached in the chat to the Media Library | yes |
| `search_strapi_docs`, `read_strapi_docs` | Finds and reads pages of the Strapi docs, for questions about Strapi itself | no |
| `use_skill` | Loads one of your [skills](#skills), when you have some | no |

Fields a role can't edit are dropped by Strapi's permission sanitizer, and the assistant is told which ones, so it never claims a change that didn't happen.

Images attached in the chat go to the Media Library through `upload_media`, as the signed-in admin and with their upload permission. Only PNG, JPEG, GIF and WebP files are accepted, recognized by their content rather than their declared type, and your `upload.security` allow and deny lists apply. The assistant can't fetch files from links. In Blocks fields a Markdown image pointing at a Media Library file, `![Alt](/uploads/owl.jpg)`, becomes an image block. Any other image becomes a link.

## Options

| Option | Default | |
|---|---|---|
| `models` | every built-in provider with credentials | Which models people can pick: `providers`, `custom` (`lmStudio()`, `ollama()`, `openAICompatible()`), `allow` globs, `default` |
| `app` | the plugin's, in each admin's language | Name, description and starter prompts, shown as written. Anything left out comes from the plugin's translations: see [Languages](#languages) |
| `instructions` | | Added to the built-in instructions: house style, required fields, glossary… |
| `skills` | | A folder of skills, relative to the project root: see [Skills](#skills) |
| `systemPrompt` | | Replaces the built-in instructions |
| `contentTools` | `true` | The in-process content tools above |
| `docs` | `true` | The Strapi docs tools: see [Questions about Strapi](#questions-about-strapi) |
| `mcp` | `false` | `{ token, url?, prefix?, roles?, contentTools? }`: Strapi's MCP server |
| `storage` | `"database"` | `"memory"` for throwaway setups, or your own adapter through `extend` |
| `maxTurns`, `approvalTimeoutMs`, `timezone` | 24, 15 min, the server's | |
| `runtimeMcp` | `false` | Let super admins connect more MCP servers from the Tools panel |
| `extend` | | `({ strapi }) => ({ tools, hooks, subagents, skills, schedules, mcpServers, storage, systemUser })` |

Strapi merges plugin config with lodash's `defaultsDeep`, which copies plain objects and loses the symbol keys tool schemas rely on. That's why anything holding code goes in `extend`, which runs once at bootstrap:

```ts
import { defineTool, requireApproval, Type, ui } from "@klymbak/strapi";

export default ({ env }) => ({
  klymbak: {
    config: {
      models: { providers: ["anthropic"] },
      extend: ({ strapi }) => ({
        tools: [
          defineTool({
            name: "newsletter_stats",
            description: "Subscriber counts for the newsletter, by list.",
            readOnly: true,
            parameters: Type.Object({}),
            execute: async () => {
              const rows = await strapi.documents("api::subscriber.subscriber").count({});
              return { text: `${rows} subscribers`, ui: ui.stats([{ label: "Subscribers", value: rows }]) };
            },
          }),
        ],
        hooks: [requireApproval({ tools: ["newsletter_send"], risk: "high" })],
        subagents: [{ name: "translator", description: "Translates entries between locales", systemPrompt: "…", tools: ["get_entry", "update_entry"] }],
        schedules: [{ id: "weekly-drafts", name: "Stale drafts", cron: "0 9 * * 1", prompt: "List drafts untouched for 30 days." }],
      }),
    },
  },
});
```

The tools, hooks and subagents API is `@klymbak/server`'s; see its [README](../../README.md#concepts).

### Skills

`instructions` is always in the prompt, so keep it short. Longer procedures go in skills, which the assistant loads only when a task needs them. With `skills: "skills"`, each folder under `skills/` in your project is one skill:

```
skills/
  write-article/
    SKILL.md
    reference/tone.md
  pre-publish-checklist/
    SKILL.md
```

```markdown
---
name: pre-publish-checklist
description: The checks an article must pass before it goes live. Use when asked to publish an article, or whether a draft is ready.
---

Read the draft with get_entry, then check each point…
```

The prompt lists each skill's name and description. The assistant reads the rest with `use_skill`, including documents the skill refers to, such as `reference/tone.md`. Skills are read at startup, so restart Strapi after editing them. Skills defined in code go in `extend` (`skills: [{ name, description, instructions, roles? }]`), where `roles` takes Strapi role codes such as `strapi-editor`. The demo has the two skills above.

### Questions about Strapi

Models know Strapi from their training, often an older version. So the assistant gets two kinds of knowledge:

- **This project**, at the start of each conversation: Strapi version and license, whether it runs under `strapi develop` (only then can the Content-type Builder change content types), locales and the default one, installed plugins, the person's role, and the content types they can read with what they may do. A conversation keeps the facts it started with; start a new one after changing locales or roles.
- **Strapi's documentation**, through `search_strapi_docs` and `read_strapi_docs`. The search runs inside Strapi over the index Strapi publishes for AI tools ([llms.txt](https://docs.strapi.io/llms.txt): every page's title and a one-line summary); pages are then fetched as Markdown. Nothing from the conversation leaves your server: only the index (refreshed daily) and the pages read are downloaded from docs.strapi.io. Long pages come back as an outline, then one section at a time.

When the server can't reach docs.strapi.io, the search uses a copy of the index that ships with the plugin (`pnpm --filter @klymbak/strapi docs:index` refreshes it before a release), and the assistant answers from the summaries and the project facts, saying it couldn't read the page itself. Set `docs: false` to remove the tools.

### Strapi's MCP server

Strapi 5.47+ ships an MCP server with list, get, create, update, delete, publish and unpublish tools for every content type, plus the media library. To connect it:

1. Enable it in `config/server.ts`: `mcp: { enabled: true }`.
2. Create a token in **Settings → Admin tokens** with only the permissions the assistant should have.
3. Set `mcp: { token: env("KLYMBAK_MCP_TOKEN") }`.

The tools appear as `strapi_media_list_assets`, `strapi_media_delete_assets`…, and the assets they read show as a gallery of previews. Strapi sets no MCP annotations on them, so the plugin treats only `list_*`, `get_*`, `media_list_*` and `media_get_*` as reads: everything else, including tools other plugins register later, asks for approval.

MCP calls run as the token, not as the person, and are capped by the token owner's permissions. That's why, while the content tools are on (the default), the plugin leaves out Strapi's per-content-type MCP tools (`list_article`, `create_article`, `publish_article`…) and keeps the ones the content tools don't cover: the media library and tools from other plugins. With both sets loaded, models mix them up. Set `mcp.contentTools: true` to load them anyway, or `contentTools: false` to work through MCP alone. Keep the token narrow either way.

### Languages

The assistant's interface follows the language each admin picks in their profile: German, Spanish, French, Italian, Japanese, Korean, Dutch, Polish, Brazilian Portuguese, Turkish, Ukrainian and Simplified Chinese, besides English. Strapi offers only English until a project lists more in `src/admin/app.ts`:

```ts
export default {
  config: { locales: ["de", "fr", "uk"] },
};
```

The strings come through Strapi's translations, so a project can change any of them there too: the plugin's own under `klymbak.*` (see `admin/src/translations/en.json`) and the chat's under `klymbak.ui.*` (see [`@klymbak/client`'s messages](../client/src/messages.ts)):

```ts
export default {
  config: {
    locales: ["fr"],
    translations: { fr: { "klymbak.plugin.name": "Rédaction", "klymbak.ui.chat.newChat": "Nouvelle question" } },
  },
};
```

Text set in the plugin's `app` option is shown as written in every language. Leave `name`, `description` or `suggestions` out to get the plugin's own in each admin's language.

Text the server writes follows the admin's language too: tool names and summaries in the Tools panel, approval cards, the tables and alerts of the content tools, notices and errors. Scheduled runs use the language of the admin who created them, and the model is asked to write their report in it. These strings live in the plugin's server (`server/src/locales`), so the translations in `app.ts` don't reach them. What the model reads stays English, and the model answers in the language people write in.

### Scheduled tasks

People can create schedules from a conversation ("every Monday at 9, list drafts nobody has touched for a month") or from the Schedules panel. They run unattended, as the person who created them and with their permissions. A change that needs approval ends the run to wait: the card shows in the conversation and in the assistant's Approvals inbox, and approving or denying it in either resumes the run. An approved change is made as the admin who approved it, with their permissions. Schedules defined in `extend` run as `systemUser`: set it to a real admin (`{ id: "1", name: "Content bot", roles: ["strapi-super-admin"] }`) so the content tools can check permissions.

### From your own code

The agent runtime is available as a Strapi service:

```ts
const runtime = strapi.plugin("klymbak").service("agent").runtime;
await runtime.runHeadless({ user, prompt: "Summarize this week's new articles", title: "Weekly digest" });
```

## How it fits together

- **Server**: the plugin runs `@klymbak/server` inside Strapi and serves its HTTP + SSE API from admin routes at `/klymbak/agent/*`, behind Strapi's admin authentication and the `plugin::klymbak.use` permission. Strapi's body parser has already consumed the request, so the plugin rebuilds a web `Request` from `ctx.request.body`, calls the agent's `fetch` handler and streams the `Response` back through Koa.
- **Identity**: the signed-in admin (`ctx.state.user`) becomes the agent's user: id, name and role codes (`strapi-super-admin`, `strapi-editor`, `strapi-author`…). Super admins also get Klymbak's `admin` role, which lets them see shared scheduled reports.
- **Permissions**: each content tool call loads the admin, generates their ability with Strapi's permission engine and uses the Content Manager's permission checker to authorize, sanitize input and sanitize output, as the Content Manager's own handlers do.
- **Admin UI**: `@klymbak/react` components, themed from the admin's design-system theme (light and dark), talking to the API with the admin's access token and refreshing it when it expires.

## Developing

In this repository:

```bash
pnpm install
pnpm dev:strapi                          # builds the plugin and its dependencies, then starts the demo on :1337
pnpm --filter @klymbak/strapi dev      # in another terminal: rebuild the plugin on change
```

The demo (`apps/strapi-demo`) is a small blog on Strapi's example content model, seeded on first start with articles (published, draft, and published with newer draft changes), authors and categories. Copy `apps/strapi-demo/.env.example` to `.env`, fill in the secrets and a model key (or load a model in LM Studio), run `pnpm dev:strapi`, open <http://localhost:1337/admin> and create the first admin. Server-side plugin changes need a Strapi restart; admin changes reload in the browser.

`pnpm test` covers the Koa bridge (with a streaming response), the database storage, Blocks ↔ Markdown, the content model helpers, the MCP tool rules, config validation, the project facts and the docs search and pages. `pnpm test:strapi` (at the repo root) builds the plugin and the demo, boots the demo headless on a fresh SQLite database and calls the content tools as a super admin, an Author and a custom role with field-level permissions: Draft & Publish statuses, filters through relations, validation errors, entries the role can't see staying out of results and approval cards, fields it can't read or change, role changes applying on the next call, uploads (content-checked and permission-checked) and the demo's skills. `pnpm --filter @klymbak/strapi verify` runs `strapi-plugin verify` on the built package. CI runs both.
