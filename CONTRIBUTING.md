# Contributing

Install dependencies with the pnpm version declared in `package.json`, then run:

```sh
pnpm typecheck
pnpm test
pnpm build
```

CI also runs `pnpm test:coverage` and a SonarQube analysis; see the quality gate section of the maintainers' testing guide. Run `pnpm test:coverage` locally when you change anything the tests should cover.

Development belongs on topic branches. Use `dev/<package>` for work confined to one package and `feat/<name>` for changes spanning packages. Merge reviewed, stable releases into `main`.

## Releasing

All public packages use the workspace version. Before merging a release, update the root version and the versions of `@dsh-agentic-roleplay/state`, `@dsh-agentic-roleplay/core`, and `@dsh-agentic-roleplay/all`, including their `workspace:<version>` dependency ranges.

Validate the publishable artifacts locally:

```sh
pnpm release:build
pnpm release:check
```

The `Publish stable packages` workflow runs on every push to `main`. It publishes state, core, and the complete bundle in dependency order. A package version that already exists on npm is skipped. npm trusted publishing must be configured for each public package against `.github/workflows/publish.yml` and the `npm` GitHub environment.

For the first release, an npm-authenticated maintainer can run `pnpm release:publish`; the script performs the same registry check before each upload.
