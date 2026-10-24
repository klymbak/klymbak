# @klymbak/vue

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

- Updated dependencies [[`bfee1df`](https://github.com/klymbak/klymbak/commit/bfee1df1820a1704b412844f1e5787ee84b35be7), [`bfee1df`](https://github.com/klymbak/klymbak/commit/bfee1df1820a1704b412844f1e5787ee84b35be7)]:
  - @klymbak/client@0.2.0
  - @klymbak/protocol@0.2.0
