# Releasing

The seven `@klymbak/*` packages are released together, at one version, with [Changesets](https://changesets.dev) and the Release workflow (`.github/workflows/release.yml`). CI never publishes on its own: it stages the new versions on npm, and a maintainer approves them with 2FA.

## In a pull request

When a change matters to people who install the packages, add a changeset:

```sh
pnpm changeset
```

Pick the packages it touches and the bump, then write a line or two for the changelog. While we're on 0.x, a minor bump is for features and breaking changes and a patch is for fixes. The changeset is a Markdown file in `.changeset/`, committed with the change. Docs, tests and the apps don't need one.

## Releasing

1. Changesets merged into `main` open a pull request called **Version Packages**, or update it if it's already open. It bumps every package to the next version, writes each `CHANGELOG.md` and deletes the changesets. Merge it when you want to release.
2. Merging it runs the Release workflow again. It builds the packages, packs them with pnpm (so `workspace:*` becomes the exact version) and stages each one on npm through trusted publishing, with no npm token. For each package it then pushes a tag such as `@klymbak/server@0.2.0` and creates a GitHub release from its changelog.
3. Approve the staged versions on npmjs.com, in the **Staged Packages** tab, with 2FA, in this order: protocol, client, server, angular, react, vue, strapi. A package approved before one it depends on won't install until that one is approved too. In a terminal, `npm stage list` and `npm stage approve <id>` do the same (npm 11.15 or later).

A pull request made by the workflow doesn't start other workflows, so CI doesn't run on Version Packages. It runs on `main` after the merge.

## When something goes wrong

- **Staging failed partway.** Packages are staged in dependency order, and staging stops at the first failure. Re-run the failed jobs from the run's page: the packages staged already have tags, so they're skipped.
- **A staged version is wrong.** Reject it on npmjs.com, fix the problem in a pull request with a changeset, and release the next version. The tag stays, and it keeps the workflow from staging that version again. To stage the same version again anyway, delete its tag and GitHub release, then re-run the workflow.

## One-time setup

- **npm**: on each package's **Settings** page, add a trusted publisher. Pick GitHub Actions, organization `klymbak`, repository `klymbak`, workflow `release.yml`, no environment, and allow staged publishing only, not `npm publish`. A new trusted publisher expires unless a version is staged through it within 2 days, so add it when a Version Packages pull request is ready to merge. Once a release has gone through this way, set **Publishing access** to require 2FA and disallow tokens.
- **GitHub**: check **Allow GitHub Actions to create and approve pull requests**, under Workflow permissions in **Settings → Actions → General**, so the workflow can open Version Packages. Check it in the `klymbak` organization's settings first, since the repository's checkbox is disabled until the organization allows it, then in the repository's.
