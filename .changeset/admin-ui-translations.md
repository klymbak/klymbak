---
"@klymbak/client": minor
"@klymbak/react": minor
"@klymbak/vue": minor
"@klymbak/angular": minor
"@klymbak/strapi": minor
---

pr: #8

The admin UI comes in 12 languages.

- `@klymbak/client` has an English message catalog, `createI18n` for words, numbers, dates and schedules in one language, and catalogs under `@klymbak/client/locales/*` for de, es, fr, it, ja, ko, nl, pl, pt-BR, tr, uk and zh-Hans. Missing messages fall back to English.
- React, Vue and Angular take `locale` and `messages` on the provider and the top-level components. The workspace takes a `description` in place of the server's welcome text.
- The Strapi plugin registers its strings through `registerTrads`, so the assistant follows each admin's profile language and projects can override any string. It has a new peer dependency, `react-intl`.
