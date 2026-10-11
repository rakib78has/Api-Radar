# Testing strategy

## Test layers

| Layer          | Tool            | Location                   | Command                  | Status                           |
| -------------- | --------------- | -------------------------- | ------------------------ | -------------------------------- |
| Unit           | Vitest          | `packages/*/tests`         | `pnpm test:unit`         | Active                           |
| Architecture   | Vitest          | `tests/architecture`       | `pnpm test:architecture` | Active                           |
| Integration    | Vitest          | `tests/integration`        | `pnpm test:integration`  | Active                           |
| Extension      | Playwright Test | `tests/e2e`                | Not yet                  | Phase 3                          |
| Regression E2E | Playwright Test | `apps/runner`, `tests/e2e` | Not yet                  | Phase 4                          |
| Security       | Vitest          | `tests/security`           | `pnpm test:security`     | Active (engine); more in Phase 5 |

`pnpm test` runs every active Vitest project. `pnpm test:coverage` also applies the coverage
gates.

## Coverage gates

Gates are enforced per directory in `vitest.config.ts`, and a run fails below them:

| Scope                           | Statements                                   | Branches | Functions | Lines |
| ------------------------------- | -------------------------------------------- | -------- | --------- | ----- |
| `packages/core/src/**`          | 90%                                          | 90%      | 90%       | 90%   |
| `packages/contracts/src/**`     | 80%                                          | 80%      | 80%       | 80%   |
| `packages/storage`, `reporting` | 80% (gate added when the package is created) |          |           |       |

Coverage covers every source file under `packages/*/src`, not only files a test imports, so
untested modules count against the gate. Generated files and UI markup have no coverage target.

## What the Phase 2 suites cover

- **Unit (`packages/*/tests`).** Every detector gets normal, boundary (window and tolerance edges) and adversarial cases (`__proto__` names, malformed percent-encoding, lone surrogates, 64-level JSON, pathological glob patterns). The hash is checked against a BigInt reference on 500 seeded random multilingual strings and against published FNV-1a vectors.
- **Determinism.** `analyze.test.ts` shuffles requests and navigations with five seeds and requires identical output.
- **Contract conformance.** Every finding, baseline and regression result produced in tests is re-parsed with its contract schema.
- **Integration.** Raw observations go through normalisation, analysis and a baseline JSON round trip, then a regressed run is compared and a sanitised report validated. Every `examples/test-rules/*.json` file must parse.
- **Security.** Canary secrets are planted in 12 channels and must never appear in persisted output. The test was mutation-checked against disabled redaction.

## Rules

- Tests must be deterministic: no real network, no wall-clock dependence (inject clocks), and no
  dependence on test order.
- Every detection rule gets normal, boundary and adversarial cases (malformed, oversized and
  hostile input).
- No skipped or disabled tests without a linked issue and a reason in the test name.
- A gate is never lowered to make CI pass. Fix the code or the test.

## Gate verification (Phase 1)

Each gate was checked against a deliberately bad file in `packages/core/src`, which was removed
afterwards:

| Gate                 | Planted defect                                 | Result                                                            |
| -------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| `pnpm format:check`  | Unformatted code                               | Failed (exit 1)                                                   |
| `pnpm lint`          | `node:fs` import, `chrome` global, `any`, `==` | 8 errors (exit 1)                                                 |
| `pnpm typecheck`     | `node:fs` import, `chrome` global              | TS2591 and TS2304 (exit 2)                                        |
| `pnpm test`          | `node:fs` import                               | Architecture test failed                                          |
| `pnpm test:coverage` | Untested function                              | Failed: core at 40% lines, 50% branches against the 90% threshold |
