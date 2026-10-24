---
"@klymbak/strapi": patch
---

pr: #8

The assistant is styled again in production admin builds (`strapi build`), which dropped the stylesheet the plugin imported. The plugin now carries the stylesheet itself.
