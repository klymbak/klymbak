# Changesets

Each Markdown file here describes a change to the `@klymbak/*` packages: which packages it touches, the bump (patch, minor or major) and a line for the changelog. Add one in a pull request that changes what users get:

```sh
pnpm changeset
```

The seven packages are versioned together (`fixed` in `config.json`), so any changeset releases all of them at the same version. The apps in `apps/` are private and never released.

When changesets reach `main`, the Release workflow opens a "Version Packages" pull request that bumps the versions and writes the changelogs. Merging it stages the new versions on npm, where a maintainer approves them with 2FA. See [RELEASING.md](../RELEASING.md).

The full documentation is at https://changesets.dev.
