---
"@klymbak/protocol": minor
"@klymbak/client": minor
"@klymbak/server": minor
"@klymbak/react": minor
"@klymbak/vue": minor
"@klymbak/angular": minor
"@klymbak/strapi": minor
---

Text the server writes comes in the person's language too.

- The components send their locale as `Accept-Language`, and the server puts it on `ctx.user.locale` unless auth set one. Tool names, Tools-panel summaries, approval titles, refusals, notices, API errors and the Strapi content tools' tables and alerts follow it. What the model reads stays in English.
- A tool's `label` and the new `summary` take a string or a function of the locale. `createTranslator` in `@klymbak/server` gives hosts ICU-style catalogs that fall back to English message by message. The message formatter moved from `@klymbak/client` to `@klymbak/protocol`, and the client still exports it.
- `@klymbak/server` and the Strapi plugin have catalogs in the same 12 languages as the client.
- Schedules keep their owner's locale, so unattended runs and their reports are written in it.
- In Strapi, approvals to publish, unpublish, delete or discard a draft show their title without the raw arguments.
