# Contributing

## Workflow

1. Branch from `main`, for example `feat/har-import` or `fix/triage-reload`.
2. Run `pnpm check` (plus `pnpm test:e2e` and `pnpm test:regression` if you touched the
   extension or the runner) before pushing.
3. Open a pull request. CI must pass, and the PR title must follow Conventional Commits (below).
4. **Squash-merge.** The PR title becomes the commit message on `main`.

## Pull-request titles: Conventional Commits

The title decides the next version and the CHANGELOG entry, so it is checked by the
`PR title` workflow.

```
<type>[optional scope][!]: <description in lower case>
```

| Type                                               | Effect on the next release      | CHANGELOG section  |
| -------------------------------------------------- | ------------------------------- | ------------------ |
| `feat`                                             | minor (0.x: minor)              | Features           |
| `fix`                                              | patch                           | Bug Fixes          |
| `perf`                                             | patch                           | Performance        |
| `revert`                                           | patch                           | Reverts            |
| `docs`                                             | none (listed only)              | Documentation      |
| `refactor`, `test`, `build`, `ci`, `chore`         | none                            | hidden             |
| `!` after the type, or a `BREAKING CHANGE:` footer | major (0.x: minor, until 1.0.0) | ⚠ Breaking Changes |

Examples:

- `feat(extension): import HAR files into a session`
- `fix(core): ignore cache-busting parameters in retry detection`
- `feat!: rename rule-set schema field duplicates.windowMs`
- `docs: explain baseline tolerances`

Scopes are optional. Common ones are `extension`, `runner`, `core`, `contracts`, `storage`,
`reporting`, `ci` and `release`.

## Releases

You do not tag or edit versions by hand. See [docs/ci-cd.md](docs/ci-cd.md#releaseyml-releases):
release-please keeps a release PR open, and merging it ships the release.

## Security

Report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
