# CI/CD

## `ci.yml`: Continuous Integration

**Triggers:** every pull request, pushes to `main`, and manual dispatch.

**Permissions:** `contents: read` only. Checkout runs with `persist-credentials: false`.

**Concurrency:** a newer run cancels an older run on the same pull request. Runs on `main` are
never cancelled.

The jobs run in parallel. Each installs from the frozen lockfile.

### Job `verify`

| Step               | Command                                    | Fails when                                                     |
| ------------------ | ------------------------------------------ | -------------------------------------------------------------- |
| Install            | `pnpm install --frozen-lockfile`           | The lockfile is out of date                                    |
| Formatting         | `pnpm format:check`                        | Any file differs from Prettier output                          |
| Lint               | `pnpm lint`                                | Any error, or any warning                                      |
| Type-check         | `pnpm typecheck`                           | Root, Playwright specs or any workspace fails `tsc`            |
| Tests and coverage | `pnpm test:coverage` (all Vitest projects) | A test fails or a coverage gate is missed                      |
| Build              | `pnpm build`                               | `tsc -b` or the Vite extension build fails                     |
| Manifest           | `pnpm validate:manifest`                   | Permissions, CSP, referenced files or remote code break policy |
| Coverage artifact  | `upload-artifact`                          | Never; it uploads even after failures                          |

### Job `extension-e2e`

| Step            | Command                                             | Fails when                                                      |
| --------------- | --------------------------------------------------- | --------------------------------------------------------------- |
| Install         | `pnpm install --frozen-lockfile`                    | The lockfile is out of date                                     |
| Browser         | `pnpm exec playwright install --with-deps chromium` | The download fails                                              |
| E2E             | `pnpm test:e2e`                                     | The E2E build, its manifest check, or any Playwright test fails |
| Report artifact | `upload-artifact` (failure only)                    | Never; uploads `playwright-report/` and `test-results/` traces  |

Traces and screenshots come from the local test application only. They never include a real
site's data.

### Job `regression`

| Step      | Command                                             | Fails when                                                                                     |
| --------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Install   | `pnpm install --frozen-lockfile`                    | The lockfile is out of date                                                                    |
| Browser   | `pnpm exec playwright install --with-deps chromium` | The download fails                                                                             |
| Scenarios | `pnpm test:regression`                              | A scenario fails or a run regresses against a committed baseline                               |
| Artifacts | `upload-artifact` (always)                          | Never; uploads `reports/runner/` (JUnit XML, HTML) and `test-results/runner/` (API QA reports) |

Baselines are changed only by committing a new `apps/runner/baselines/*.json`, so every change is
reviewed in a pull request.

### Job `security`

| Step     | Command                          | Fails when                                                                                         |
| -------- | -------------------------------- | -------------------------------------------------------------------------------------------------- |
| Install  | `pnpm install --frozen-lockfile` | A dependency wants to run an install script (`strictDepBuilds`)                                    |
| Secrets  | `pnpm security:secrets`          | A tracked file contains a credential-shaped string                                                 |
| Lockfile | `pnpm security:lockfile`         | A package is not from the npm registry, lacks an sha512 hash, or a workspace link escapes the repo |
| Audit    | `pnpm security:audit`            | A dependency has a known high or critical vulnerability                                            |
| Tests    | `pnpm test:security`             | Redaction, hostile-input or fuzz tests fail                                                        |

### Job `dependency-review` (pull requests)

`actions/dependency-review-action` fails a pull request that adds or upgrades a dependency with a
known high or critical vulnerability, or with a licence outside the allowlist. The allowlist is
the licences in the tree today: MIT, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, BlueOak-1.0.0 and
MPL-2.0.

## `codeql.yml`: static analysis

CodeQL runs the `security-extended` JavaScript and TypeScript queries on pull requests, pushes to
`main`, and weekly. Results appear under **Security → Code scanning**. The job has
`security-events: write` and nothing else.

## `release.yml`: releases

**Trigger:** pushing a tag `vMAJOR.MINOR.PATCH`, or running the workflow by hand for an existing
tag.

**Job `verify` (read-only):** checks out the tag, then:

1. `pnpm release:check`: the tag matches both package versions and has a CHANGELOG section.
2. `pnpm check` and `pnpm security`.
3. The extension E2E suite, the regression scenarios, and `pnpm test:package`, which builds the
   zip and loads it in Chromium.
4. Uploads `release/` as an artifact.

**Job `draft`** runs in the `release` environment and needs `contents: write`, `id-token: write`
and `attestations: write`. It:

1. downloads the verified package and re-checks `SHA256SUMS`;
2. writes the release notes from CHANGELOG.md;
3. attests build provenance for the zip;
4. creates a **draft** GitHub release.

Nothing is ever published to the Chrome Web Store automatically.

The tag reaches scripts only through the `RELEASE_TAG` environment variable, never through
expression interpolation. `release:check` rejects anything that is not strict semver before the
tag is used.

### Repository settings to enable (once, by a maintainer)

| Setting                                                                                                            | Why                                                                    |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| **Settings → Environments → `release`**: required reviewers                                                        | Every release needs a person's approval                                |
| **Settings → Rules → Rulesets**: protect `main` (PR + passing checks) and tags `v*` (restricted creation)          | Only reviewed code is tagged, and only maintainers create release tags |
| **Settings → Code security**: secret scanning, push protection, Dependabot alerts, private vulnerability reporting | GitHub-side detection that complements the repository checks           |

Each third-party action is pinned to a full commit SHA, with the tag in a trailing comment. The
SHAs were resolved from the upstream repositories with `git ls-remote --tags`. Annotated tags were
dereferenced (`^{}`) to their commit.

| Action                    | Tag    | Commit                                     |
| ------------------------- | ------ | ------------------------------------------ |
| `actions/checkout`        | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `pnpm/action-setup`       | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` |
| `actions/setup-node`      | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

To update an action, resolve the new tag's commit the same way, then replace both the SHA and the
comment.

## Not yet implemented

- Publishing to the Chrome Web Store, which stays a manual step by design.
