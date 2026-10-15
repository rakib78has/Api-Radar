# Testing strategy

## Test layers

| Layer           | Tool            | Location               | Command                  | Status                  |
| --------------- | --------------- | ---------------------- | ------------------------ | ----------------------- |
| Unit            | Vitest          | `packages/*/tests`     | `pnpm test:unit`         | Active                  |
| Architecture    | Vitest          | `tests/architecture`   | `pnpm test:architecture` | Active                  |
| Extension logic | Vitest          | `apps/extension/tests` | `pnpm test:extension`    | Active                  |
| Integration     | Vitest          | `tests/integration`    | `pnpm test:integration`  | Active                  |
| Security        | Vitest          | `tests/security`       | `pnpm test:security`     | Active; more in Phase 5 |
| Extension E2E   | Playwright Test | `tests/e2e`            | `pnpm test:e2e`          | Active                  |
| Extension smoke | Playwright Test | `tests/e2e` (`@smoke`) | `pnpm test:smoke`        | Active                  |
| Regression E2E  | Playwright Test | `apps/runner`          | Not yet                  | Phase 4                 |

`pnpm test` runs every Vitest project. `pnpm test:coverage` also applies the coverage gates.

## Coverage gates

Gates are enforced per directory in `vitest.config.ts`, and a run fails below them:

| Scope                           | Statements | Branches | Functions | Lines |
| ------------------------------- | ---------- | -------- | --------- | ----- |
| `packages/core/src/**`          | 90%        | 90%      | 90%       | 90%   |
| `packages/contracts/src/**`     | 80%        | 80%      | 80%       | 80%   |
| `packages/storage/src/**`       | 80%        | 80%      | 80%       | 80%   |
| `packages/reporting/src/**`     | 80%        | 80%      | 80%       | 80%   |
| `apps/extension/src/**` (logic) | 80%        | 80%      | 80%       | 80%   |

Coverage counts every matching source file, not only files a test imports.

Some extension code is excluded from the unit-coverage gate:

- the service-worker wiring (`service-worker.ts`);
- the Chrome adapters (`chrome-store.ts`, `client.ts`, `zod-config.ts`);
- the React views (`popup/`, `panel/`).

That code is exercised by the Playwright suite instead. UI markup has no coverage target.

## What the suites cover

- **Unit (`packages/*/tests`).**
  - **Detectors:** every detector gets normal, boundary (window and tolerance edges) and
    adversarial cases.
  - **Hash:** checked against a BigInt reference implementation and the published FNV-1a vectors.
  - **Storage:** chunk boundaries, 20 overlapping appends, the 50,000-request cap, corrupt
    records, triage, and retention.
  - **Reporting:** CSV formula injection, HTML injection, and the embedded CSP.
- **Determinism.** `analyze.test.ts` shuffles the input with five seeds and requires identical
  output.
- **Contract conformance.** Every finding, baseline, regression result and report produced in tests
  is re-parsed with its contract schema.
- **Extension logic (`apps/extension/tests`).**
  - **Request tracker:** joining webRequest events, redirect hops, form and raw bodies, file
    uploads, and lost starts after a worker restart.
  - **Capture controller:** tab and origin scoping, redaction before storage, batching, resuming
    after a restart, closing the tab, permission refusal, and serialised mutations.
  - **Message handler:** every malformed command, the sender trust check, and every command path.
  - **Manifest policy:** permissions, CSP, forbidden keys, and remote code.
- **Integration.** Raw observations, then normalisation, analysis, a baseline JSON round trip,
  regression comparison, and a sanitised report.
- **Security.** Canary secrets in 12 channels must never reach persisted output. The test was
  mutation-checked against disabled redaction.
- **Extension E2E (`tests/e2e`).** Playwright launches Chromium with the unpacked E2E build. The
  test pages come from a local server; no live website is used. The suite verifies:
  - the real `chrome.webRequest` capture path and messaging;
  - the dashboard findings, triage persistence and request table;
  - that no secrets reach `chrome.storage`;
  - that the HTML export is escaped and script-free;
  - saved rules, navigation recording, ending the capture when the tab closes, and the
    permission refusal;
  - that web pages cannot message the extension.

  The suite passed 18 of 18 runs with `--repeat-each=3`.

### The E2E build

`pnpm --filter @api-qa/extension build:e2e` writes `apps/extension/dist-e2e`. It is identical to
the production build except that it declares `host_permissions: ["http://127.0.0.1/*"]`.
Automated browsers cannot click Chrome's permission prompt, so the test server is pre-granted.
Everything after the grant (capture, storage, UI) is the production code path.
`validate:manifest:e2e` checks that this is the only difference.

## Not covered automatically

- **The permission prompt itself:** it cannot be automated. Check it manually by loading `dist`,
  starting a capture, and accepting the prompt.
- **Service-worker suspension in a real browser:** the restart path is covered by
  `capture-controller.test.ts`, using a fresh controller over the same storage.
- **The request-after-navigation detector against real traffic:** browsers stop a page's timers
  when it is replaced, so real stale requests are rare and timing-dependent. The detector is
  covered by unit tests, and navigation recording by E2E.

## Rules

- Tests must be deterministic: no live network, no wall-clock dependence (inject clocks), and no
  dependence on test order. Playwright retries are off, so flakiness shows up as a failure.
- No skipped or disabled tests without a linked issue and a reason in the test name.
- A gate is never lowered to make CI pass. Fix the code or the test.
