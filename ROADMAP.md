# Roadmap

Where Klymbak is heading and in what order. Tick items off as they ship, and record why the order changes when it does.

## Done

- **`@klymbak/client`**: the framework-agnostic browser side (API client, chat store, formatting, Markdown), with `subscribe`/`getVersion` change notifications for frameworks without deep reactivity.
- **Shared stylesheet**: every component's CSS lives in `@klymbak/client/styles`; the built `@klymbak/vue/style.css` is unchanged byte for byte, and `@klymbak/react` ships the same file.
- **`@klymbak/react`**: `AgentWorkspace`, `AgentChat`, `AgentWidget` and every building block, for React 18.2+ and 19, with a playground in `apps/react-console` (`pnpm dev:react`). At parity with `@klymbak/vue`:
  - [x] `AgentWorkspace` with `SessionList`, `SchedulePanel` and `CapabilitiesPanel`
  - [x] Toasts animate out, not just in
  - [x] While streaming, only the changing message re-renders (`touchedMessages` in the protocol, `getMessageRevision` on the store)
  - [x] A live run end to end in the playground against Qwen 3.6 35B-A3B in LM Studio: streaming, tool cards, an approval denied with a reason, two subagents in parallel
- **`@klymbak/strapi`**: Klymbak as a Strapi 5 plugin (5.47+, tested on 5.58), with a demo blog in `apps/strapi-demo` (`pnpm dev:strapi`). A plugin rather than a fork: Strapi releases weekly, and a plugin works in every Strapi project under our own license.
  - [x] **Server**: `@klymbak/server` runs inside the plugin; conversations and schedules live in Strapi's database (two hidden plugin content types).
  - [x] **Mounting on Koa**: admin routes at `/klymbak/agent/*` rebuild a `Request` from `ctx.request.body`, call `agent.fetch()` and stream the `Response` back through Koa. They sit behind Strapi's admin authentication and a `plugin::klymbak.use` permission; `ctx.state.user` becomes the agent's user.
  - [x] **Acting as the person**: ten in-process content tools on `strapi.documents()` that authorize, sanitize input and sanitize output with the Content Manager's permission checker, so field, locale and condition-based permissions ("only entries they created") apply per call, also in scheduled runs. Checked live with a super admin and an Author.
  - [x] **Strapi's MCP server**, optional, with an admin token. Its tools carry no annotations, so the plugin treats only `list_*`, `get_*` and `media_list_*`/`media_get_*` as reads and puts everything else behind approval, including tools other plugins add later. Rather than the `requireApproval` regex planned here, MCP servers' `approval`, `readOnly`, `include` and `exclude` now accept a function, which also shows the right approval state in the Tools panel. The per-content-type MCP tools load only when the content tools are off: with both, a local model mixed them up and reached for the token's tools.
  - [x] **Admin UI** with `@klymbak/react`, themed from the admin's design system (light and dark) and its language: a full page from the menu, an edit-view side panel (`addEditViewSidePanel`) whose chat floats beside the form and refreshes it after the agent changes the entry, and a list-view bulk action (`addBulkAction`) to ask about the selection. The admin's short-lived access token is refreshed on a 401.
  - [x] **Media shows as pictures**: the media library tools and `get_entry` render images and videos in a gallery (a `media` UI block, which any MCP server whose results carry file URLs and MIME types gets too). Links are limited to http(s) and paths, and images in the model's Markdown load only from the admin's own origin; others become links, so a prompt injection can't leak data through an image URL.
  - [x] Runs can carry page context (`RunRequest.context`, the `context` prop on `AgentChat` in React and Vue): what the person has open, for the model only.
  - [x] A live run end to end in the admin against Qwen 3.6 35B-A3B in LM Studio: answering from filters, updating with approval (a validation error read and fixed), a denial with a reason, drafting an article with relations and a dynamic zone, the side panel and the bulk action.
  - [x] **Knows Strapi**: each conversation starts with the project's facts (version, license, develop or production mode, locales and which types are localized, plugins, the person's role and readable content types), and `search_strapi_docs`/`read_strapi_docs` answer questions about Strapi from docs.strapi.io's `llms.txt` index and Markdown pages, searched in-process. Checked against Qwen 3.8 27B: locales answered from the facts, "let Authors publish" from the RBAC page, "add a reading time field" from the Content-type Builder page and the develop-mode fact. The demo now defaults to Qwen 3.8 27B.

## Next for the Strapi plugin

- [x] CI on every push and pull request (`.github/workflows/ci.yml`): build, typecheck, unit tests, `strapi-plugin verify`, the demo's admin panel build, and the integration test. Verify wanted `bugs` as an object in package.json; all six packages now use that form.
- [x] An integration test (`pnpm test:strapi`) that boots the demo headless on a fresh database and runs the content tools as a super admin, an Author and a custom role with field-level permissions. Breaking the role-condition filter in `find_entries` makes it fail, as it should.
- Publish to npm and submit to the Strapi Marketplace
- Media uploads (the content tools reference uploaded files only), and Blocks images written from Markdown
- Translations of the admin UI strings (`registerTrads`)
- An offline copy of the docs index for servers that can't reach docs.strapi.io
- Skills in `@klymbak/server` for procedures and house rules (how we write an article, a pre-publish checklist): each skill's name and "use when" line in the prompt, its text loaded on demand by a tool, in Anthropic's `SKILL.md` format. Every host gets them, not only Strapi.

## Later: more hosts

Ranked from the October 2026 research on open-source admin products, weighing license, admin stack, how much back-office work the product has, traction, and whether it already ships its own agent.

1. **Bagisto** (MIT; Laravel with a Vue 3 admin; e-commerce): the Acme demo on a real store. A Node service calls Bagisto's API.
2. **Chatwoot** (MIT outside `enterprise/`; Rails with a Vue 3 dashboard; support desk): an open alternative to its paid Captain copilot that can act, not only draft. Never touch `enterprise/`.
3. **Medusa** (MIT except the RBAC/SSO paths; Node with a React admin; headless commerce): tools call Medusa's workflows in-process.
4. **Krayin CRM** (MIT; Laravel with a Vue 3 admin): same vendor and layout as Bagisto, so most of that integration carries over.

Ruled out: Directus (already ships its own AI assistant, and its MSCL license forbids competing use; use its MCP server as a data source instead), NocoDB (Sustainable Use License bars commercial distribution of forks), Uptime Kuma (operations rather than back office).

## Platform

- Run the React tests against React 19 as well as 18
- Angular: try compiling the Vue components to a web component (`defineCustomElement`) before writing bindings
- A .NET 10 server implementing the same HTTP/SSE protocol
- A Postgres storage adapter and per-tenant model budgets
- MCP OAuth flows in the integrations panel (pi-mcp already implements the client side)
- An eval harness that replays real transcripts against new prompts and models
