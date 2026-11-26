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

Releasing is a tag, not a push to `main`. Once the version bump is merged, tag the commit and push the tag:

```sh
git tag -a v0.14.0 -m "Release 0.14.0"
git push origin v0.14.0
```

The `Publish tagged releases` workflow runs on the tag and publishes state, core, and the complete bundle in dependency order. It refuses a tag that does not name the workspace version, so bump the version before tagging. A package version that already exists on npm is skipped, which is how a partly-finished release is resumed: re-run the failed jobs of the same tag. Pushing to `main` publishes nothing — `Code analysis` builds, tests and scans that commit. The SonarQube verdict is not part of the publish gate: tagging is the maintainer's decision, and a red gate on the tagged commit is visible in that workflow's history. npm trusted publishing must be configured for each public package against `.github/workflows/publish.yml` and the `npm` GitHub environment.

For the first release, an npm-authenticated maintainer can run `pnpm release:publish`; the script performs the same registry check before each upload.
