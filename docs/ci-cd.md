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

## `pr-title.yml`: Conventional Commit titles

Pull requests are squash-merged, so the PR title becomes the commit message that release-please
reads. This workflow fails a PR whose title is not a Conventional Commit. Allowed types are
`feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore` and `revert`, and the
description must start in lower case.

It uses `pull_request_target`, so it also works for pull requests from forks. It never checks
out or runs PR code; it reads only the title. Because of `pull_request_target`, the workflow's
configuration comes from `main`, so it starts checking PRs once it is merged. See
[CONTRIBUTING.md](../CONTRIBUTING.md) for the rules.

## `release.yml`: releases

Releases are automated with [release-please](https://github.com/googleapis/release-please). The
release PR is the human sign-off: nobody tags, bumps versions or edits the changelog by hand.

```
feat/fix PRs merged to main
        │
        ▼
release-please ── opens or updates "chore: release X.Y.Z" (versions in both package.json
        │          files, the .release-please-manifest.json, and CHANGELOG.md)
        │  maintainer reviews and merges the release PR
        ▼
release-please ── tags vX.Y.Z (force-tag-creation) and creates a DRAFT release with the notes
        ▼
verify          ── release:check, pnpm check, pnpm security, extension E2E, regression
        │          scenarios, package and load the zip in Chromium, upload the artifact
        ▼
publish         ── [approval: environment "release"] checksums, provenance attestation,
        │          attach zip, files.txt and SHA256SUMS, publish the release as Latest
        ▼
chrome-web-store ─ [only if configured] [approval: environment "chrome-web-store"]
                   upload with Chrome Web Store API V2, submit for review (staged by default)
```

| Job                | Permissions                                   | Notes                                                                                                   |
| ------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `release-please`   | `contents`, `pull-requests`, `issues`: write  | Runs on every push to `main`; does nothing unless there are releasable commits                          |
| `verify`           | read-only                                     | Runs only when a release was just created, or for a manual run                                          |
| `publish`          | `contents`, `id-token`, `attestations`: write | In the `release` environment                                                                            |
| `chrome-web-store` | read-only                                     | In the `chrome-web-store` environment; skipped unless `CWS_EXTENSION_ID` and `CWS_PUBLISHER_ID` are set |

**Version rules** (from PR titles):

- `fix` and `perf` give a patch release.
- `feat` gives a minor release.
- `!` or `BREAKING CHANGE` gives a major release; before 1.0.0, `bump-minor-pre-major` makes it a
  minor release.
- `docs`, `chore`, `ci`, `test`, `refactor` and `build` alone do not trigger a release.

**Configuration:** `release-please-config.json` and `.release-please-manifest.json`. The
`extra-files` entry keeps `apps/extension/package.json` (the manifest version) in step with the
root version, and `release:check` fails the run if they ever disagree.

**Manual run:** **Actions → Release → Run workflow** with an existing tag rebuilds and verifies
that tag and attaches its assets. If the release does not exist yet, it creates one with the
notes from CHANGELOG.md. Use this for a tag created by hand, or to retry after a failure.

**Rollback:** a published GitHub release can be edited back to draft, or deleted, under
**Releases**. A store submission can be cancelled in the Developer Dashboard. Ship the fix as the
next patch version, because a version number is never reused.

### Repository settings (once, by a maintainer)

| Setting                                                                                                                                                 | Why                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **Settings → Actions → General → Workflow permissions:** allow GitHub Actions to create and approve pull requests                                       | Required for release-please to open the release PR with `GITHUB_TOKEN` |
| **Settings → General → Pull Requests:** allow squash merging only; default commit message "Pull request title"                                          | Makes the checked PR title the commit message                          |
| **Settings → Environments → `release`:** required reviewers                                                                                             | A person approves every release before it is published                 |
| **Settings → Environments → `chrome-web-store`:** required reviewers; store secrets and variables (below)                                               | A second approval before anything reaches the store                    |
| **Settings → Rules → Rulesets:** `main` requires a PR, passing checks (CI, PR title) and no force-push; tags `v*` restricted to maintainers and Actions | Only reviewed code is released                                         |
| **Settings → Advanced Security:** dependency graph, Dependabot alerts, secret scanning, push protection, private vulnerability reporting                | GitHub-side detection that complements the repository checks           |

**CI on release PRs (optional).** GitHub does not run workflows for PRs opened with
`GITHUB_TOKEN`, so the release PR shows no checks. That is safe: the release PR only changes
versions and the changelog, and `verify` re-runs every gate on the tagged commit before
anything is published. But a ruleset that requires checks will block merging it. To get normal
CI on release PRs:

1. Create a GitHub App with **Contents: read and write** and **Pull requests: read and write**,
   and install it on the repository.
2. Set the repository variable `RELEASE_APP_CLIENT_ID` and the secret `RELEASE_APP_PRIVATE_KEY`.

release-please then acts as the app, and its PRs and tags trigger workflows like a person's
would.

### Chrome Web Store submission (optional)

The job uses the Chrome Web Store API **V2**; V1 reached end of support on 2026-10-15. It
uploads to an **existing** item, because the first listing must be created by hand in the
[Developer Dashboard](https://chrome.google.com/webstore/devconsole).

1. Create the item once by hand: upload the first zip and fill in the listing and the privacy
   form.
2. In Google Cloud, enable the Chrome Web Store API and create an OAuth client (type "Web
   application", redirect URI `https://developers.google.com/oauthplayground`).
3. In the [OAuth Playground](https://developers.google.com/oauthplayground), use your own client
   to authorise the scope `https://www.googleapis.com/auth/chromewebstore` and obtain a refresh
   token.
4. In the `chrome-web-store` environment, add:
   - **secrets:** `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`;
   - **variables:** `CWS_PUBLISHER_ID` (Developer Dashboard → Publisher → Settings) and
     `CWS_EXTENSION_ID` (the item's 32-letter id);
   - optionally `CWS_PUBLISH_TYPE`.
5. Choose `CWS_PUBLISH_TYPE`:
   - `STAGED_PUBLISH` (default): after review passes, you press Publish in the dashboard.
   - `DEFAULT_PUBLISH`: the item goes live automatically after review.

The store rejects an upload whose manifest version is not higher than the published one, so a
failed or repeated run never overwrites a live version.

## Not yet implemented

- Publishing to the Chrome Web Store, which stays a manual step by design.
