---
name: write-article
description: How Field Notes articles are written and structured. Use when drafting a new article, rewriting one, or writing an article's title, description or slug.
---

# Writing a Field Notes article

Field Notes is a small blog about technology, food and nature. People read it for short, specific posts they can finish in a few minutes.

## Before you write

1. Read two or three published articles in the same category (find_entries, then get_entry) and match their length and tone.
2. Use a category that exists. Don't create one; if none fits, ask.
3. If the person didn't say who the author is, ask. Never guess an author.

## Structure

- **Title**: plain and specific, under 60 characters, in sentence case. No clickbait, no "Title: subtitle".
- **Slug**: the title in lowercase with hyphens, leaving out small words (a, the, of, and).
- **Description**: one sentence of at most 80 characters (Strapi enforces the limit) saying what the reader gets.
- **Blocks**: one `shared.rich-text` block with the body. Add a `shared.quote` block before it only for a real quote with a named source.
- **Body**: three to six short paragraphs. Open with the point, not the background. One idea per paragraph. Use a `##` subheading only when there are more than five paragraphs.

## Tone

Follow `reference/tone.md`.

## When you're done

Create the article as a draft and tell the person what to check. Don't publish it here: publishing goes through the `pre-publish-checklist` skill.
