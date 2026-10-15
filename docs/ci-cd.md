# CI/CD

## `ci.yml`: Continuous Integration

**Triggers:** every pull request, pushes to `main`, and manual dispatch.

**Permissions:** `contents: read` only. Checkout runs with `persist-credentials: false`.

**Concurrency:** a newer run cancels an older run on the same pull request. Runs on `main` are
never cancelled.

Two jobs run in parallel. Each job installs from the frozen lockfile.

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

## Action pinning

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

- `release.yml`: tag-gated packaging, zip and checksums (Phase 5).
- Security pipeline: dependency audit, secret scanning, lockfile review (Phase 5).
