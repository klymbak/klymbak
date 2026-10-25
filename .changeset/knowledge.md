---
"@klymbak/protocol": minor
"@klymbak/server": minor
"@klymbak/client": minor
"@klymbak/react": minor
"@klymbak/vue": minor
"@klymbak/angular": minor
"@klymbak/strapi": minor
---

Knowledge: documents, tickets and tables the agent searches and cites.

- `knowledgeTools({ sources })` in `@klymbak/server` gives the agent `search_knowledge`, `read_knowledge` and, with tables, `lookup_knowledge` (the names follow `name`). Sources: `knowledge.folder` (Markdown, HTML, text and PDF files; PDFs need the optional `unpdf` package), `knowledge.llmsTxt` (a docs site's llms.txt, with every page's text from llms-full.txt), `knowledge.sitemap`, `knowledge.documents` (anything your code loads, such as helpdesk articles, HTML converted), `knowledge.tickets` and `knowledge.table` (CSV, TSV or .xlsx files and links, or rows from your code). Each source can be limited by `roles`.
- Search runs section by section: documents split at their headings (PDFs by page), titles, paths, summaries, headings and text scored with stemmed keywords (BM25F), the document's fields apart from the passage's, code samples counting little, synonyms and stop words configurable. Results name the passage and its document, and long documents are read an outline first, then a section at a time.
- Tables are looked up by column: whole cells, items of a list in a cell or number comparisons, ignoring case and punctuation. When no row matches, the closest values are suggested.
- `knowledge.tickets` removes each ticket's customer before indexing: their name (in parts too), email, phone, address and the `private` values given, such as order and tracking numbers, plus any email, phone, card or account number. `redact: false` keeps them.
- Optional semantic search: `embeddings: openAIEmbeddings({ baseUrl, model })` embeds passages as they load (only new or changed ones, kept in `cacheDir`) and merges both rankings. When the endpoint fails, search falls back to keywords and says so.
- Remote sources refresh daily. With `cacheDir`, a copy of the last load is searched while a site can't be reached.
- A `sources` UI block (`ui.sources(items)`) cites documents with their link, location and passage. React, Vue and Angular render it (`SourceList`), with long passages opening in place, in 12 languages besides English.
- The Strapi plugin's `search_strapi_docs` and `read_strapi_docs` are now these tools: they search every page's text from docs.strapi.io's llms-full.txt by section, return the passage that matched, and show it as a source with a link to the page.
