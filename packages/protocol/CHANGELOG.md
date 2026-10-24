# @klymbak/protocol

## 0.3.0

### Minor Changes

- [#13](https://github.com/klymbak/klymbak/pull/13) [`30bdac6`](https://github.com/klymbak/klymbak/commit/30bdac63d233ddc2471f0214f648efe579e83619) Thanks [@Berezhnyk](https://github.com/Berezhnyk)! - Approvals wait in unattended runs instead of being refused.
  
  - When a scheduled or `runHeadless` run reaches a call that needs approval, the run ends after that step and the call is stored with the session (`pendingApprovals`). Its card shows in the conversation and everyone who can see the session gets an `approval_pending` notification.
  - Deciding it through the usual approvals route, hours later or after a restart, resumes the session as a new run. An approved call runs as the person who approved it, so the tool's roles, the policy hooks and the tool see them (`ctx.headless` false); approving takes someone who may use the tool. Denied calls tell the model why, and the model carries on as the run's own user. When one step asks for several approvals, the run resumes once all are decided. New messages in that session get a 409 (`approvals_pending`) until then.
  - `ApprovalView.waits` marks such an approval, so the end of its run leaves the card open.
  - The client store follows a run that starts in the open conversation elsewhere, so the resumed run streams in.
  - Delegated tasks still refuse approvals in unattended runs.
  - A session that ran unattended now asks in the moment when a person carries on in it, instead of treating their run as unattended too.

## 0.2.0

### Minor Changes

- [#10](https://github.com/klymbak/klymbak/pull/10) [`bfee1df`](https://github.com/klymbak/klymbak/commit/bfee1df1820a1704b412844f1e5787ee84b35be7) Thanks [@Berezhnyk](https://github.com/Berezhnyk)! - Text the server writes comes in the person's language too.
  
  - The components send their locale as `Accept-Language`, and the server puts it on `ctx.user.locale` unless auth set one. Tool names, Tools-panel summaries, approval titles, refusals, notices, API errors and the Strapi content tools' tables and alerts follow it. What the model reads stays in English.
  - A tool's `label` and the new `summary` take a string or a function of the locale. `createTranslator` in `@klymbak/server` gives hosts ICU-style catalogs that fall back to English message by message. The message formatter moved from `@klymbak/client` to `@klymbak/protocol`, and the client still exports it.
  - `@klymbak/server` and the Strapi plugin have catalogs in the same 12 languages as the client.
  - Schedules keep their owner's locale, so unattended runs and their reports are written in it.
  - In Strapi, approvals to publish, unpublish, delete or discard a draft show their title without the raw arguments.
