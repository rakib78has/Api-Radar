# API QA Inspector

A QA tool that watches the API requests a web application makes and flags:

- duplicate requests
- unexpected calls
- excessive polling and retry loops
- calls that continue after navigation
- request-count regressions against a baseline

It has two front ends on one shared analysis engine:

1. A **Chrome extension** (Manifest V3) for manual testing. _Available._
2. A **Playwright runner** for automated regression testing in CI. _Available._

> **Status: version 0.1.0. All five phases are complete.** See [Roadmap](#roadmap) and the
> [changelog](CHANGELOG.md).

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

## Automated regression testing (Playwright runner)

`apps/runner` runs browser workflows with Playwright. It records each page's traffic through the
Chrome DevTools Protocol, then analyses it with the same engine and rules as the extension:

```ts
import { expectNoFindings, expectNoRegressions } from '../fixtures/assertions.js';
import { test } from '../fixtures/api-qa.js';

test.use({ rules: 'regression' }); // apps/runner/rules/regression.json

test('checkout keeps its API budget', async ({ apiQa }) => {
  await apiQa.start();
  await apiQa.runScenario('/s/count?n=2'); // or drive any page with `page`
  const result = await apiQa.stop();

  expectNoFindings(result.analysis, 'medium'); // fails with a readable list of findings
  const regression = apiQa.compare(result, 'cart-flow'); // apps/runner/baselines/cart-flow.json
  await apiQa.report(result, regression); // JSON, HTML and CSV attached to the test result
  expectNoRegressions(regression);
});
```

- `pnpm test:regression` runs every scenario against the committed baselines. Results go to
  `reports/runner/` (JUnit XML and an HTML report) and `test-results/runner/` (API QA reports).
- `pnpm baselines:update` re-records the baselines from tests tagged `@baseline`. Review the JSON
  diff before committing it.
- The scenarios use a controlled local test application (`apps/runner/src/fixtures/test-app.ts`).
  Playwright starts it automatically on `127.0.0.1:47130`.

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

### Seed data: is everything still working?

`examples/seed/` holds a recorded shop workflow with one of every problem the engine detects:

- duplicate orders;
- a retry loop;
- fast polling;
- stale and route-change requests;
- forbidden, missing and over-called endpoints.

It also plants secrets in every channel that must be redacted, and comes with rules, a baseline
and the expected findings.

```sh
pnpm seed:check
```

The check runs the seed through normalisation and redaction, analysis, baseline comparison and
report export, then prints a PASS/FAIL line per check. Open `reports/seed/api-qa-report.html` to
see the resulting report. The same check runs in CI as part of the integration suite.

## Commands

| Command                  | What it does                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `pnpm check`             | Every gate except the browser suite                                                   |
| `pnpm format`            | Rewrite files with Prettier                                                           |
| `pnpm format:check`      | Verify formatting                                                                     |
| `pnpm lint`              | ESLint with type-aware rules; warnings fail                                           |
| `pnpm typecheck`         | `tsc` for root files, Playwright specs and every workspace                            |
| `pnpm test`              | All Vitest projects                                                                   |
| `pnpm test:unit`         | Package unit tests (`packages/*/tests`)                                               |
| `pnpm test:architecture` | Package-boundary rules                                                                |
| `pnpm test:extension`    | Extension logic: capture, messaging, filters, manifest policy                         |
| `pnpm test:integration`  | Cross-package pipeline and example rule files                                         |
| `pnpm test:security`     | Redaction canaries and hostile input                                                  |
| `pnpm test:coverage`     | All Vitest projects with coverage gates; HTML report in `coverage/`                   |
| `pnpm test:smoke`        | Extension smoke tests in Chromium (`@smoke`)                                          |
| `pnpm test:runner`       | Runner logic: CDP assembler, sessions, baselines, reports                             |
| `pnpm test:regression`   | The 14 regression scenarios in Chromium against committed baselines                   |
| `pnpm baselines:update`  | Re-record baselines from `@baseline` tests (review the diff!)                         |
| `pnpm test:e2e`          | Builds the E2E extension, validates it, runs every Playwright test                    |
| `pnpm build`             | Builds the packages (`tsc -b`) and the extension (Vite) to `dist/`                    |
| `pnpm security`          | Secret scan, lockfile policy, dependency audit, security and fuzz tests               |
| `pnpm security:secrets`  | Scan tracked files for credential-shaped strings                                      |
| `pnpm security:lockfile` | Enforce registry, integrity hashes and workspace links in the lockfile                |
| `pnpm security:audit`    | `pnpm audit`, failing on high or critical vulnerabilities                             |
| `pnpm test:tooling`      | Tests for the release and security tooling                                            |
| `pnpm icons`             | Regenerate the extension icons (`pnpm icons:check` verifies them)                     |
| `pnpm package:extension` | Build, validate and zip the extension into `release/`, with checksums                 |
| `pnpm seed:check`        | Run the seed workflow end to end and print PASS/FAIL per check                        |
| `pnpm test:package`      | Package, then load the release zip in Chromium                                        |
| `pnpm release:check`     | Check a tag against the package versions and CHANGELOG.md                             |
| `pnpm validate:manifest` | Checks permissions, CSP, referenced files and remote code in `apps/extension/dist`    |
| `pnpm clean`             | Remove all generated output: package and extension builds, coverage, reports, release |

## Repository layout

```
apps/
  extension/      Manifest V3 extension: service worker, popup, dashboard (React)
  runner/         Playwright regression runner: CDP capture, fixtures, scenarios, baselines
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
manual dispatch. Its jobs run in parallel:

- **verify:** every `pnpm check` gate.
- **extension-e2e:** the extension suite in Chromium.
- **regression:** the runner scenarios against committed baselines, with JUnit and HTML reports
  uploaded as artifacts.
- **security:** secret scan, lockfile policy, dependency audit, and the security and fuzz tests.
- **dependency-review** (pull requests only): blocks new vulnerable or unapproved-licence
  dependencies.

[CodeQL](.github/workflows/codeql.yml) runs static analysis on every change and weekly. The
[release workflow](.github/workflows/release.yml) runs on version tags.

Actions are pinned to commit SHAs. See [docs/ci-cd.md](docs/ci-cd.md).

## Releasing

1. Update `version` in `package.json` and `apps/extension/package.json`.
2. Move the `[Unreleased]` notes in `CHANGELOG.md` into a `## [x.y.z] - YYYY-MM-DD` section.
3. Run `pnpm release:check vX.Y.Z`.
4. Merge, then push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
5. The [release workflow](.github/workflows/release.yml) re-runs every gate on the tagged commit,
   then waits for approval in the `release` environment. Once approved, it creates a **draft**
   GitHub release with:
   - the zip;
   - a per-file checksum list;
   - `SHA256SUMS`;
   - a build-provenance attestation.
6. Review the draft. Verify the zip with `sha256sum --check SHA256SUMS` and
   `gh attestation verify <zip> --repo rakib78has/Api-Radar`. Then publish the draft and upload
   the zip to the Chrome Web Store by hand.

Packaging is reproducible: the same commit produces a byte-identical zip on any machine.

## Security

- **Reporting:** see [SECURITY.md](SECURITY.md).
- **Design:** the privacy model, threat model and supply-chain controls are in
  [docs/security.md](docs/security.md).

## Environment variables

No `.env` file is needed.

| Variable               | Used by         | Effect                                                                                                               |
| ---------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `CI`                   | Playwright      | `true` (set by GitHub Actions) forbids `test.only` and writes HTML reports                                           |
| `UPDATE_BASELINES`     | Runner          | `1` makes `apiQa.compare()` record the baseline instead of comparing. Set by `pnpm baselines:update`                 |
| `API_QA_PACKAGE_TEST`  | Playwright      | `1` includes the `@package` test (set by `pnpm test:package`)                                                        |
| `API_QA_TEST_APP_PORT` | Runner test app | Port of the controlled test app (default `47130`). Baselines contain the origin, so re-record them after changing it |

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
| 4     | Playwright runner, controlled test app, baselines                     | Complete |
| 5     | Security pipeline, release packaging                                  | Complete |

## Troubleshooting

- **The popup closed while Chrome asked for site access.** Chrome may close the popup when the
  permission prompt takes focus. Open the popup again and press **Start capture**: access is now
  granted, so the capture starts straight away.
- **Nothing is captured.** Check **Permissions & limits** in the dashboard. Requests are recorded
  only for the captured tab and for origins with granted access.
- **`ERR_PNPM_UNSUPPORTED_ENGINE`:** switch to Node.js 24 (`nvm use`) and pnpm 10.34.x.
- **`pnpm format:check` fails on Windows only:** line endings. The repo enforces LF through
  `.gitattributes`. Run `pnpm format`.
- **`Test app could not listen on port 47130`:** another process uses the port. Stop it, or set
  `API_QA_TEST_APP_PORT` and run `pnpm baselines:update`.
- **A baseline comparison fails after an intended change:** run `pnpm baselines:update`, review the
  JSON diff, and commit it with the change.
- **Playwright cannot find a browser:** run `pnpm exec playwright install chromium`.
- **`Build the E2E extension first`:** run `pnpm --filter @api-qa/extension build:e2e`, or use
  `pnpm test:e2e`, which builds it.
