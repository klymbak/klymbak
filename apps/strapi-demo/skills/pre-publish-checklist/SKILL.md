---
name: pre-publish-checklist
description: The checks a Field Notes article must pass before it goes live. Use when asked to publish an article, or whether a draft is ready to publish.
---

# Before publishing an article

Read the draft with get_entry, then go through every check. Report all failed checks in one list, each with a suggested fix. Don't publish until every check passes, unless the person explicitly says to publish anyway.

1. Title, slug, description, category and author are all set.
2. The title is under 60 characters. The description is one sentence of at most 80 characters.
3. The slug matches the title (lowercase, hyphens) and no other article uses it: run find_entries with a filter on `slug`.
4. The body has at least three paragraphs and no placeholder text: TODO, TK, lorem ipsum, [link].
5. Every link is a full `https://` URL.
6. A quote block names its source.

When every check passes, call publish_entry. The person approves the publish there, so don't ask in text first.
