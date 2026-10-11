# API QA Inspector

A QA tool that watches the API requests a web application makes and flags:

- duplicate requests
- unexpected calls
- excessive polling and retry loops
- calls that continue after navigation
- request-count regressions against a baseline

It will ship as two front ends on one shared analysis engine:

1. A **Chrome extension** (Manifest V3) for manual testing.
2. A **Playwright runner** for automated regression testing in CI.

> **Status: Phase 2 (analysis engine) complete.** The shared contracts and detection engine are
> implemented and tested. There is no Chrome extension or Playwright runner yet. See
> [Roadmap](#roadmap).

## What it detects

| Detector                  | Reports                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Duplicate requests        | Equivalent requests from one page within a time window, rated by impact              |
| Excessive polling         | Polling faster than a configured interval and tolerance                              |
| Retry loops               | Retries beyond the allowed attempts, or faster than the minimum delay                |
| Requests after navigation | Calls from a page the user already left                                              |
| Endpoint rules            | Required, forbidden, exact, minimum and maximum call counts; unexpected endpoints    |
| Regression                | New or missing endpoints, more calls, higher failure rates, slower p95, new findings |

How each one decides is documented in [docs/detection-rules.md](docs/detection-rules.md). Example
rule files are in [examples/test-rules](examples/test-rules). Sensitive data is redacted before
anything is stored; see [docs/security.md](docs/security.md).

## Requirements

| Tool    | Version | Check           |
| ------- | ------- | --------------- |
| Node.js | 24 LTS  | `node -v`       |
| pnpm    | 10.34.x | `pnpm -v`       |
| Git     | any     | `git --version` |

`engine-strict` is on, so installing with an unsupported Node.js or pnpm version fails.

Install pnpm with `npm install -g pnpm@10.34.6`, or run `corepack enable`. The exact version is
pinned in `package.json` under `packageManager`.

## Setup

```sh
pnpm install
pnpm check      # runs every quality gate, the same steps as CI
```

## Commands

| Command                  | What it does                                                  |
| ------------------------ | ------------------------------------------------------------- |
| `pnpm check`             | All gates: format, lint, typecheck, test with coverage, build |
| `pnpm format`            | Rewrite files with Prettier                                   |
| `pnpm format:check`      | Verify formatting (CI)                                        |
| `pnpm lint`              | ESLint with type-aware rules; warnings fail                   |
| `pnpm typecheck`         | `tsc` for root files and every workspace                      |
| `pnpm test`              | All Vitest projects                                           |
| `pnpm test:unit`         | Unit tests (`packages/*/tests`)                               |
| `pnpm test:architecture` | Package-boundary rules (`tests/architecture`)                 |
| `pnpm test:integration`  | Cross-package pipeline and example rule files                 |
| `pnpm test:security`     | Redaction canaries and hostile input                          |
| `pnpm test:coverage`     | Tests with coverage gates; HTML report in `coverage/`         |
| `pnpm test:watch`        | Vitest in watch mode                                          |
| `pnpm build`             | `tsc -b` builds every package to `dist/`                      |
| `pnpm clean`             | Remove build output                                           |

## Repository layout

```
packages/
  contracts/      types, Zod schemas, size limits, safe parsing (no browser or Node.js APIs)
  core/           normalisation, redaction, fingerprints, detectors, baselines
                  (no Chrome, React, Playwright or Node.js APIs)
tests/
  architecture/   repository-wide rules, such as import boundaries
  integration/    full pipeline across packages
  security/       redaction canaries, hostile input
examples/
  test-rules/     example detection rule files
docs/             architecture, detection rules, security, testing strategy, CI/CD
.github/workflows/ci.yml
```

Each package has two TypeScript configs:

- `tsconfig.json` type-checks `src` and `tests` against the other packages' sources.
- `tsconfig.build.json` emits `dist/`.

[docs/architecture.md](docs/architecture.md) explains why, and how the boundaries are enforced.

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pull requests, pushes to `main` and
manual dispatch. It installs from the frozen lockfile, runs every gate, then uploads the coverage
report. Actions are pinned to commit SHAs. See [docs/ci-cd.md](docs/ci-cd.md).

## Environment variables

None. No `.env` file is needed.

## Roadmap

| Phase | Scope                                                                 | Status   |
| ----- | --------------------------------------------------------------------- | -------- |
| 1     | Monorepo, strict TS, ESLint, Prettier, Vitest, CI                     | Complete |
| 2     | Contracts and analysis engine: normalisation, fingerprints, detection | Complete |
| 3     | Chrome extension: capture, messaging, UI, storage, export             | Next     |
| 4     | Playwright runner, controlled test app, baselines                     | Planned  |
| 5     | Security pipeline, redaction tests, release packaging                 | Planned  |

## Troubleshooting

- **`ERR_PNPM_UNSUPPORTED_ENGINE`**: switch to Node.js 24 (`nvm use`) and pnpm 10.34.x.
- **`pnpm format:check` fails on Windows only**: line endings. The repo enforces LF through
  `.gitattributes`. Run `pnpm format`, or re-checkout after `git config core.autocrlf false`.
- **Lint reports "file not found in any project"**: every `.ts` file must be covered by a
  `tsconfig.json`. Root files are covered by the root config, and package files by the package's
  config.
