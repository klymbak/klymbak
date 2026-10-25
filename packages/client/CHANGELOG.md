# @klymbak/client

## 0.5.0

### Minor Changes

- [#17](https://github.com/klymbak/klymbak/pull/17) [`49cf588`](https://github.com/klymbak/klymbak/commit/49cf588d4a6d946913f99af194a77431484c71b7) Thanks [@Berezhnyk](https://github.com/Berezhnyk)! - An approval inbox, and drafted arguments a person can edit before approving.
  
  - `ApprovalInbox` in React, Vue and Angular (`<kl-approval-inbox>`) lists what unattended runs left waiting for the signed-in person, across conversations, oldest first. Each card can be approved, denied with a reason, or edited first, and links to its conversation. `AgentWorkspace` offers it in the sidebar, with a count, while something waits, and so does the Strapi plugin's assistant page.
  - The server lists it at `GET /approvals` (`runtime.listApprovals(user)`): approvals in sessions the person can see, for tools their roles may use. A chat's own approvals stay in that chat. A new `approval_decided` notification takes a decided approval out of everyone's inbox.
  - A tool's approval can name text arguments the person deciding may change: `edit: ["message"]` or `{ name, label, multiline }`, also from a `preToolUse` hook. The card shows them as fields (`ApprovalView.fields`), `ApprovalDecision.edits` carries the changes, and the call runs with them. The card is marked `edited`, the model is told what changed, and the default card body leaves the editable arguments out. Edits that aren't for a field, aren't text, or that the tool's parameters reject get a 400, and the approval keeps waiting. This works in waiting and in-chat approvals alike.
  - The client store keeps `state.inbox` current from notifications, catching up after a reconnect. `decide(approvalId, decision, sessionId?)` decides in a conversation that isn't open, and resolves to whether the decision was recorded.

### Patch Changes

- Updated dependencies [[`49cf588`](https://github.com/klymbak/klymbak/commit/49cf588d4a6d946913f99af194a77431484c71b7)]:
  - @klymbak/protocol@0.5.0

## 0.4.0

### Minor Changes

- [#15](https://github.com/klymbak/klymbak/pull/15) [`3daee10`](https://github.com/klymbak/klymbak/commit/3daee1052495426eb010d2964c2dfbc6157e3913) Thanks [@Berezhnyk](https://github.com/Berezhnyk)! - MCP servers' resources and prompts come to the chat.
  
  - Typing `@` in the message box lists the connected servers' resources and resource templates. A chosen resource shows as a chip; a template asks for a value for each variable. The server reads them when the message is sent: the model gets their contents, marked as data, and the transcript shows their names.
  - Typing `/` at the start of a message lists their prompts. Choosing one asks for its arguments, and its text opens the message.
  - When a server supports MCP completions, the fields for arguments and variables suggest values as people type (`POST /mcp/complete`).
  - A resource that can't be read, or a missing required value, refuses the message before the run starts.
  - The model reads resources itself with the new built-in tools `list_resources` and `read_resource`, and a resource link in a tool's result names its server so it can follow it. An app's own tool of the same name wins over a built-in one.
  - The Tools panel lists the servers' prompts and resources.
  - Everything follows the server's `roles`, and the lists stay current when a server says they changed. `resources: false` or `prompts: false` in a server's config turns them off.
  - `AgentConfigInfo` has `resources`, `resourceTemplates` and `prompts`, and `RunRequest` takes `resources` (by URI, or by template and values) and `mcpPrompt`. The transcript has two new parts, `resource` and `prompt`. `@klymbak/protocol` has `expandTemplate` and the other RFC 6570 helpers.
  - `store.send(text, attachments, references)` sends them and `store.completeMcp` asks for suggestions. `findMention`, `mentionOptions` and the other helpers in `@klymbak/client` build the menus and fields, and the `Composer` in each binding takes `resources`, `resourceTemplates`, `prompts` and `complete`.

### Patch Changes

- Updated dependencies [[`3daee10`](https://github.com/klymbak/klymbak/commit/3daee1052495426eb010d2964c2dfbc6157e3913)]:
  - @klymbak/protocol@0.4.0

## 0.3.0

### Minor Changes

- [#13](https://github.com/klymbak/klymbak/pull/13) [`30bdac6`](https://github.com/klymbak/klymbak/commit/30bdac63d233ddc2471f0214f648efe579e83619) Thanks [@Berezhnyk](https://github.com/Berezhnyk)! - Approvals wait in unattended runs instead of being refused.
  
  - When a scheduled or `runHeadless` run reaches a call that needs approval, the run ends after that step and the call is stored with the session (`pendingApprovals`). Its card shows in the conversation and everyone who can see the session gets an `approval_pending` notification.
  - Deciding it through the usual approvals route, hours later or after a restart, resumes the session as a new run. An approved call runs as the person who approved it, so the tool's roles, the policy hooks and the tool see them (`ctx.headless` false); approving takes someone who may use the tool. Denied calls tell the model why, and the model carries on as the run's own user. When one step asks for several approvals, the run resumes once all are decided. New messages in that session get a 409 (`approvals_pending`) until then.
  - `ApprovalView.waits` marks such an approval, so the end of its run leaves the card open.
  - The client store follows a run that starts in the open conversation elsewhere, so the resumed run streams in.
  - Delegated tasks still refuse approvals in unattended runs.
  - A session that ran unattended now asks in the moment when a person carries on in it, instead of treating their run as unattended too.

### Patch Changes

- Updated dependencies [[`30bdac6`](https://github.com/klymbak/klymbak/commit/30bdac63d233ddc2471f0214f648efe579e83619)]:
  - @klymbak/protocol@0.3.0

## 0.2.0

### Minor Changes

- [#8](https://github.com/klymbak/klymbak/pull/8) [`8cb90bc`](https://github.com/klymbak/klymbak/commit/8cb90bc3da6509d19ac25878ac8df5b96ff2db37) Thanks [@Berezhnyk](https://github.com/Berezhnyk)! - The admin UI comes in 12 languages.
  
  - `@klymbak/client` has an English message catalog, `createI18n` for words, numbers, dates and schedules in one language, and catalogs under `@klymbak/client/locales/*` for de, es, fr, it, ja, ko, nl, pl, pt-BR, tr, uk and zh-Hans. Missing messages fall back to English.
  - React, Vue and Angular take `locale` and `messages` on the provider and the top-level components. The workspace takes a `description` in place of the server's welcome text.
  - The Strapi plugin registers its strings through `registerTrads`, so the assistant follows each admin's profile language and projects can override any string. It has a new peer dependency, `react-intl`.

- [#10](https://github.com/klymbak/klymbak/pull/10) [`bfee1df`](https://github.com/klymbak/klymbak/commit/bfee1df1820a1704b412844f1e5787ee84b35be7) Thanks [@Berezhnyk](https://github.com/Berezhnyk)! - Text the server writes comes in the person's language too.
  
  - The components send their locale as `Accept-Language`, and the server puts it on `ctx.user.locale` unless auth set one. Tool names, Tools-panel summaries, approval titles, refusals, notices, API errors and the Strapi content tools' tables and alerts follow it. What the model reads stays in English.
  - A tool's `label` and the new `summary` take a string or a function of the locale. `createTranslator` in `@klymbak/server` gives hosts ICU-style catalogs that fall back to English message by message. The message formatter moved from `@klymbak/client` to `@klymbak/protocol`, and the client still exports it.
  - `@klymbak/server` and the Strapi plugin have catalogs in the same 12 languages as the client.
  - Schedules keep their owner's locale, so unattended runs and their reports are written in it.
  - In Strapi, approvals to publish, unpublish, delete or discard a draft show their title without the raw arguments.

### Patch Changes

- Updated dependencies [[`bfee1df`](https://github.com/klymbak/klymbak/commit/bfee1df1820a1704b412844f1e5787ee84b35be7)]:
  - @klymbak/protocol@0.2.0
