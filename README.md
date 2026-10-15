# API QA Inspector

A QA tool that watches the API requests a web application makes and flags:

- duplicate requests
- unexpected calls
- excessive polling and retry loops
- calls that continue after navigation
- request-count regressions against a baseline

It has two front ends on one shared analysis engine:

1. A **Chrome extension** (Manifest V3) for manual testing. _Available._
2. A **Playwright runner** for automated regression testing in CI. _Phase 4._

> **Status: Phase 3 (Chrome extension) complete.** See [Roadmap](#roadmap).

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
rule files are in [examples/test-rules](examples/test-rules).

## Using the extension

1. Build it: `pnpm install && pnpm build`.
2. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select
   `apps/extension/dist`.
3. Open the web application you want to test, click the extension icon, and press
   **Start capture**.
   - Chrome asks for access to that site the first time. Access is requested only for the origins
     you capture.
   - If your API is on another origin, list it under _Other API origins_ before starting.
4. Use the application as normal, then press **Stop and analyse**. The dashboard opens.
5. In the dashboard you can:
   - filter findings by type, severity, triage state or endpoint;
   - expand **Evidence** to see the requests and measurements behind a finding;
   - mark findings **Confirm bug**, **Expected** or **Ignore**;
   - browse and filter the captured requests;
   - edit or import detection rules (**Rules** tab);
   - export a sanitised report (HTML, JSON or CSV);
   - delete one session or clear all data.

**Privacy:** data never leaves the browser.

- Credentials and fragments are removed before anything is stored.
- Sensitive query values become `[REDACTED]`, and token-like path segments become `:token`.
- Request bodies are reduced to a fingerprint; headers and cookies are never read.
- Old sessions are deleted automatically (20 sessions or 30 days by default).

See [docs/security.md](docs/security.md).

## Requirements

| Tool    | Version | Check              |
| ------- | ------- | ------------------ |
| Node.js | 24 LTS  | `node -v`          |
| pnpm    | 10.34.x | `pnpm -v`          |
| Chrome  | 116+    | `chrome://version` |
| Git     | any     | `git --version`    |

`engine-strict` is on, so installing with an unsupported Node.js or pnpm version fails.

Install pnpm with `npm install -g pnpm@10.34.6`, or run `corepack enable`. The exact version is
pinned in `package.json` under `packageManager`. Browser tests also need Playwright's Chromium:
`pnpm exec playwright install chromium`.

## Setup

```sh
pnpm install
pnpm check      # format, lint, typecheck, tests with coverage, build, manifest validation
pnpm test:e2e   # the unpacked extension in Chromium
```

## Commands

| Command                  | What it does                                                                       |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `pnpm check`             | Every gate except the browser suite                                                |
| `pnpm format`            | Rewrite files with Prettier                                                        |
| `pnpm format:check`      | Verify formatting                                                                  |
| `pnpm lint`              | ESLint with type-aware rules; warnings fail                                        |
| `pnpm typecheck`         | `tsc` for root files, Playwright specs and every workspace                         |
| `pnpm test`              | All Vitest projects                                                                |
| `pnpm test:unit`         | Package unit tests (`packages/*/tests`)                                            |
| `pnpm test:architecture` | Package-boundary rules                                                             |
| `pnpm test:extension`    | Extension logic: capture, messaging, filters, manifest policy                      |
| `pnpm test:integration`  | Cross-package pipeline and example rule files                                      |
| `pnpm test:security`     | Redaction canaries and hostile input                                               |
| `pnpm test:coverage`     | All Vitest projects with coverage gates; HTML report in `coverage/`                |
| `pnpm test:smoke`        | Extension smoke tests in Chromium (`@smoke`)                                       |
| `pnpm test:e2e`          | Builds the E2E extension, validates it, runs every Playwright test                 |
| `pnpm build`             | Builds the packages (`tsc -b`) and the extension (Vite) to `dist/`                 |
| `pnpm validate:manifest` | Checks permissions, CSP, referenced files and remote code in `apps/extension/dist` |
| `pnpm clean`             | Remove package build output                                                        |

## Repository layout

```
apps/
  extension/      Manifest V3 extension: service worker, popup, dashboard (React)
packages/
  contracts/      types, Zod schemas, size limits, safe parsing
  core/           normalisation, redaction, fingerprints, detectors, baselines
  storage/        validated session and settings persistence (any key-value store)
  reporting/      sanitised JSON, CSV and HTML reports
tests/
  architecture/   repository-wide rules, such as import boundaries
  integration/    full pipeline across packages
  security/       redaction canaries, hostile input
  e2e/            Playwright: the real extension in Chromium, against a local test app
examples/
  test-rules/     example detection rule files
docs/             architecture, detection rules, security, testing strategy, CI/CD
```

The shared packages never import Chrome, React, Playwright or Node.js APIs. This is enforced by
the compiler, ESLint and an architecture test. See [docs/architecture.md](docs/architecture.md).

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on pull requests, pushes to `main` and
manual dispatch. Two jobs run in parallel:

- **verify:** every `pnpm check` gate.
- **extension-e2e:** the Playwright suite in Chromium.

Actions are pinned to commit SHAs. See [docs/ci-cd.md](docs/ci-cd.md).

## Environment variables

None. No `.env` file is needed. `CI=true`, set by GitHub Actions, makes Playwright forbid
`test.only` and write an HTML report.

## Known limitations

The extension observes traffic with `chrome.webRequest`:

- **Bodies:** response bodies are never available. Request bodies are available only for form and
  raw uploads.
- **Timing:** durations are approximate.
- **Request types:** XHR and fetch cannot be told apart.
- **Capture scope:** requests from service workers or other tabs are not captured.
- **Restarts:** a running capture ends when the browser restarts.

The [detection rules](docs/detection-rules.md#known-limitations) and
[security](docs/security.md#residual-risks) documents list the rest.

## Roadmap

| Phase | Scope                                                                 | Status   |
| ----- | --------------------------------------------------------------------- | -------- |
| 1     | Monorepo, strict TS, ESLint, Prettier, Vitest, CI                     | Complete |
| 2     | Contracts and analysis engine: normalisation, fingerprints, detection | Complete |
| 3     | Chrome extension: capture, messaging, UI, storage, export             | Complete |
| 4     | Playwright runner, controlled test app, baselines                     | Next     |
| 5     | Security pipeline, release packaging                                  | Planned  |

## Troubleshooting

- **The popup closed while Chrome asked for site access.** Chrome may close the popup when the
  permission prompt takes focus. Open the popup again and press **Start capture**: access is now
  granted, so the capture starts straight away.
- **Nothing is captured.** Check **Permissions & limits** in the dashboard. Requests are recorded
  only for the captured tab and for origins with granted access.
- **`ERR_PNPM_UNSUPPORTED_ENGINE`:** switch to Node.js 24 (`nvm use`) and pnpm 10.34.x.
- **`pnpm format:check` fails on Windows only:** line endings. The repo enforces LF through
  `.gitattributes`. Run `pnpm format`.
- **Playwright cannot find a browser:** run `pnpm exec playwright install chromium`.
- **`Build the E2E extension first`:** run `pnpm --filter @api-qa/extension build:e2e`, or use
  `pnpm test:e2e`, which builds it.
