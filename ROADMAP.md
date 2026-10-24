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
- **`@klymbak/angular`**: `AgentWorkspace`, `AgentChat`, `AgentWidget` and every building block as standalone Angular components with signals, for Angular 21 and 22 (built and tested zoneless, Angular's default), with a playground in `apps/angular-console` (`pnpm dev:angular`). Written as native bindings rather than the Vue components compiled to web components, as planned under Platform: the same API as React and Vue (inputs, `(action)`, content slots, Angular components as renderers, `provideKlymbak()`), and no Vue runtime inside Angular apps.
  - [x] Compiled by `ngc` in partial mode and published from the package folder like the others (`dist/`, `.js` imports); apps link it with their own Angular. Built with Angular 21, the oldest version it supports; its CLI wants TypeScript 5.9, pinned in the package and the playground until 21 is dropped.
  - [x] The store reaches templates as a signal (`injectAgentState()`), and while streaming only the changing message renders again (an OnPush row per message, keyed on `getMessageRevision`)
  - [x] Toasts animate out with `animate.leave`, the widget panel with Vue's transition classes, like the other bindings
  - [x] Tests in Vitest with Analog's Vite plugin (AOT), a Vitest project of their own in `pnpm test`
  - [x] A live run in the playground against Qwen 3.6 35B-A3B in LM Studio: streaming, a table with row actions, an approval denied with a reason and then approved, the widget, dark mode, a chart. It found a bug the tests now cover: zoneless Angular renders after events, so Enter right after typing left the sent text in the box.
  - [x] Published to npm as 0.1.0 (2026-10-17), on the `@klymbak/client` and `@klymbak/protocol` 0.1.0 already there
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
- [x] Published to npm as 0.1.0 (2026-10-17) and submitted to the Strapi Marketplace. Strapi declined to list it because it competes with the AI features Strapi sells, so the plugin is installed from npm only.
- [x] **Media uploads**: `upload_media` puts an image attached in the chat into the Media Library, as the signed-in admin, with approval and their upload permission. Raster images only (PNG, JPEG, GIF, WebP, recognized by content), with the project's `upload.security` lists applied. In Blocks fields, a Markdown image pointing at a Media Library file becomes an image block; other images stay links.
- ~~Uploads from a link (`upload_media` with a URL)~~: dropped (2026-10-22). Attaching an image in the chat covers the need, and fetching links on the server would need SSRF protection for little gain.
- [x] A Blocks field in the demo (`bio` on Author, seeded as one paragraph), so the integration test covers image blocks end to end: a Markdown image of an uploaded file is stored as the Blocks editor stores it and reads back as Markdown, other images stay links, and so do Media Library images for a role that can't read the Media Library.
- [x] **Translations of the admin UI**: an i18n layer in `@klymbak/client` (an English message catalog in ICU MessageFormat's basics, with fallback, plural rules and locale-aware numbers, dates and schedules) and catalogs for 12 languages: German, Spanish, French, Italian, Japanese, Korean, Dutch, Polish, Brazilian Portuguese, Turkish, Ukrainian and Simplified Chinese. React, Vue and Angular take `locale` and `messages` (provider and top-level components, overridable per component), and the store's own toasts and errors are messages translated when shown. The Strapi plugin registers both its own strings and the chat's through `registerTrads`, so the assistant follows each admin's profile language and projects can override any string in `src/admin/app.ts`. The plugin's default name, description and starter prompts moved to the admin's translations, so they follow the language too. Checked live in Ukrainian and German: the page, the Tools and Schedules panels, the edit-view panel and the bulk action. Text the server writes came later (next item).
- [x] **Server-written text in the admin's language**: the components send their `locale` as `Accept-Language` and the server puts it on `ctx.user.locale`, so tool names and Tools-panel summaries (`label` and a new `summary`, each a string or a function of the locale), approval titles, refusals, notices, API errors and the content tools' tables and alerts come in the person's language. `createTranslator` gives hosts the same ICU-style catalogs as the client, whose formatter moved to `@klymbak/protocol`. The server ships its own strings in the same 12 languages, and so does the Strapi plugin (`server/src/locales`). What the model reads stays English. Schedules keep their owner's language for unattended runs, and the model is asked to write the run in it, report included. Checked live in German and Ukrainian with qwen3.8-27b in the Strapi demo.
- [x] An offline copy of the docs index (`server/src/docs-index.json`, 297 pages, refreshed by `pnpm --filter @klymbak/strapi docs:index`): the search falls back to it when docs.strapi.io can't be reached and tries the site again after 10 minutes, and a page that can't be read still gives its summary. A copy fetched earlier wins over the shipped one.
- [x] **Skills** in `@klymbak/server` for procedures and house rules: `skills` in the runtime config, `loadSkills(dir)` for folders in Anthropic's `SKILL.md` format, each skill's name and description in the prompt, its text and documents loaded on demand by `use_skill`, `roles` per skill, and a Skills section in the Tools panel (React and Vue). In the Strapi plugin a `skills` folder option (and `skills` in `extend`); the demo ships `write-article` and `pre-publish-checklist`. Every host gets them, not only Strapi.

## Next: work that starts from a ticket

Support automation for a small online store is a common client request: answer customers faster through the helpdesk the team already uses, turn product knowledge and policies into a knowledge base and training for virtual assistants, and later forecast inventory. Klymbak already has the agent, approvals, roles, skills and schedules. What it lacks is work that starts from an incoming ticket instead of a chat, with a person approving hours later. The core items come first because every helpdesk integration needs them.

### Core

- [ ] **Triggers**: `POST /triggers/:name` checks the sender's signature and turns the payload (a new ticket, an order event) into a headless run with the payload as context.
- [ ] **Approvals that wait**: approvals are in-memory promises that expire after `approvalTimeoutMs` (15 minutes by default), and headless runs refuse them. Instead, a headless run that reaches an approval saves the pending call in the session record and ends; the decision resumes the session from its transcript plus the tool result, so it survives a restart. Check first that pi's loop can continue from a transcript that ends in a tool result.
- [ ] **An approval inbox** in React, Vue and Angular: pending approvals across sessions, filtered by role, where a person approves, denies with a reason, or edits a drafted reply before it goes out.
- [ ] **Knowledge**: `knowledgeTools({ sources })` in `@klymbak/server`, generalized from the Strapi plugin's docs search (stemmed scoring, an offline index, search and read tools). Sources: folders of Markdown and PDF, sitemaps and `llms.txt`, helpdesk articles, resolved tickets, and CSV or spreadsheet tables searched by field. A table answers "does part X fit model Y" more reliably than vector search. Results cite their sources in a UI block so people can check them. Embeddings later, as an optional adapter. Skills stay for procedures and house rules; knowledge holds facts.

### Integrations

- [ ] **A helpdesk adapter**: one interface for tickets, threads, customers, drafts, private notes, tags and articles. Each implementation brings its tools, a webhook parser for triggers, and a ticket sidebar with `AgentChat` and the open ticket as page context, like the Strapi edit-view panel. Where the vendor runs an MCP server, use it, with function filters for `approval` and `readOnly`.
- [ ] **A store adapter**: orders, customers, refunds, inventory and fulfillments, with refunds and cancellations behind approval.

Which helpdesks and stores come first is up to the host evaluation below.

### Delivery

- [ ] **Evals from a client's history**: an eval harness that replays real transcripts against new prompts and models (moved here from Platform), pointed at a client's past resolved tickets. The agent drafts a reply, an LLM judge compares it with what staff sent, and a person spot-checks. The report is what a paid audit delivers, and the proof that the agent works on that client's data.
- [ ] **A deployment kit**: a Docker image or one-click template, a Postgres storage adapter and per-tenant model budgets (moved here from Platform), and a usage and cost page from pi's cost tracking, so a client's instance takes an hour to set up and little to run.
- [ ] **A trainer for new staff**: an onboarding handbook exported from skills and knowledge, and a subagent that plays customers from past tickets and grades the answers.
- [ ] **A support-desk demo**: Acme gets a ticket queue. A ticket arrives, the agent investigates and drafts a reply with a refund waiting for approval, and a support agent approves it from the inbox.

## Host evaluation (to redo)

The October 2026 ranking of open-source admin products (Bagisto, Chatwoot, Medusa, Krayin; Directus, NocoDB and Uptime Kuma ruled out) is discarded. It weighed license, stack, back-office work, traction and whether a product ships its own agent, but not whether the vendor sells AI features and will treat Klymbak as a competitor. Strapi did: it declined the plugin for its Marketplace. A plugin can still be installed from npm, but people who browse the vendor's listing won't find it.

The new evaluation covers helpdesks and stores and adds these questions:

- Does the vendor sell AI features, or plan to, and do its marketplace rules allow an app that overlaps with them?
- Can Klymbak integrate and be installed without the vendor's approval (public API, webhooks, a privately installed sidebar app)?
- How often do clients ask for it?

## Platform

- Run the React tests against React 19 as well as 18
- Run the Angular tests against Angular 22 as well as 21
- A .NET 10 server implementing the same HTTP/SSE protocol
- MCP OAuth flows in the integrations panel (pi-mcp already implements the client side)
