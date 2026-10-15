# Architecture

API QA Inspector is a pnpm monorepo. A Chrome extension (manual testing) and a Playwright
runner (automated regression testing) share one analysis engine.

## Workspace layout

| Path                  | Status (Phase 4) | Responsibility                                                       |
| --------------------- | ---------------- | -------------------------------------------------------------------- |
| `packages/contracts`  | Implemented      | Types, Zod runtime schemas, size limits, safe parsing                |
| `packages/core`       | Implemented      | Normalisation, redaction, fingerprints, detectors A–E, baselines     |
| `packages/storage`    | Implemented      | Validated, chunked session store; settings; retention                |
| `packages/reporting`  | Implemented      | Sanitised JSON, CSV (injection-safe) and HTML (escaped, CSP) reports |
| `apps/extension`      | Implemented      | MV3 capture (webRequest), messaging, popup and dashboard (React)     |
| `apps/runner`         | Implemented      | Playwright + CDP capture, fixtures, scenarios, baselines, reports    |
| `tests/architecture`  | Active           | Repository-wide rules, such as package import boundaries             |
| `tests/integration`   | Active           | Full pipeline across packages; example rule files                    |
| `tests/security`      | Active           | Redaction canaries, hostile rule files                               |
| `tests/e2e`           | Active           | The unpacked extension in Chromium, against a local test server      |
| `examples/test-rules` | Active           | Example rule sets, validated by the integration suite                |

### Inside `@api-qa/core`

| Folder           | Contents                                                               |
| ---------------- | ---------------------------------------------------------------------- |
| `normalization/` | Method, resource type, URL and body sanitisation; `normalizeRequest`   |
| `rules/`         | Endpoint pattern matcher; compiled endpoint rules and polling policies |
| `detection/`     | One module per detector, plus shared request and finding helpers       |
| `confidence/`    | Severity and confidence classification                                 |
| `analysis/`      | `analyzeRequests` (runs every detector) and endpoint statistics        |
| `regression/`    | `createBaseline`, `compareWithBaseline`                                |
| `hash.ts`        | FNV-1a 64 over UTF-8                                                   |

Detection behaviour is specified in [detection-rules.md](detection-rules.md), and the privacy
model in [security.md](security.md).

Packages are created only when there is real code for them, so the workspace never contains
empty placeholder packages. `pnpm-workspace.yaml` already includes `apps/*`.

## Dependency rules

```
apps/extension ─┐
                ├─► reporting ─┐
apps/runner ────┤              ├─► core ─► contracts ─► zod
                └─► storage ───┘
```

- `contracts` and `core` must not import Chrome APIs, React, Playwright or Node.js modules.
- Arrows point one way only, so there are no cycles.

Three independent layers enforce these rules:

1. **Compiler.** Shared packages compile with `lib: ["ES2023"]` and `types: []`, so `chrome`,
   `window`, `document` and `node:*` modules do not type-check.
2. **ESLint.** `no-restricted-imports` and `no-restricted-globals` apply to `packages/*/src`.
3. **Architecture test.** `tests/architecture/package-boundaries.test.ts` parses every import
   (static, dynamic and `require`) with the TypeScript pre-processor. It checks them, and each
   `package.json` runtime dependency, against an allowlist per package. A new package under
   `packages/` fails the suite until someone adds an allowlist entry for it.

## Decisions

### ADR-001: TypeScript 6.0, not 7.0

TypeScript 7.0 (the native compiler) is the npm `latest` tag. However, typescript-eslint 8.71.1
declares `typescript >=4.8.4 <6.1.0`, and type-aware linting is a required quality gate.
TypeScript is pinned to **6.0.3**. Revisit when typescript-eslint supports 7.x.

### ADR-002: `NodeNext` module resolution for shared packages

Shared packages are consumed by Vite (extension) and Node.js (Playwright runner). `NodeNext`
produces standards-compliant ESM that both can load without a bundler, at the cost of explicit
`.js` extensions on relative imports. Apps may use `moduleResolution: "Bundler"`.

### ADR-003: Packages export built `dist/`; checks and tests read sources

- `package.json` `exports` point at `dist/*.js` and `dist/*.d.ts`. That is what apps and Node.js
  load, and the build verifies that.
- `tsconfig.workspace.json` maps `@api-qa/*` to `src/index.ts` through `paths`, and
  `vitest.config.ts` uses matching aliases. Type-checking and tests therefore never depend on a
  stale build.
- `tsconfig.build.json` files (composite, project references) do not inherit those `paths`, so
  `tsc -b` checks the real package boundary.

### ADR-004: Strictness options

On top of `strict`: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
`noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`,
`noUnusedParameters`, `verbatimModuleSyntax` and `isolatedModules`. These two were evaluated and
enabled:

- `exactOptionalPropertyTypes` matches the requirement to represent unavailable data explicitly.
  An optional field that is absent is different from one set to `undefined`.
- `noUncheckedIndexedAccess` makes array and record lookups in detection code handle misses.

Linting uses typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`.

### ADR-005: Toolchain versions

| Tool                         | Version | Notes                                                    |
| ---------------------------- | ------- | -------------------------------------------------------- |
| Node.js                      | 24 LTS  | `.nvmrc`; `engines` enforced through `engine-strict`     |
| pnpm                         | 10.34.6 | `packageManager` field; CI reads it                      |
| TypeScript                   | 6.0.3   | See ADR-001                                              |
| ESLint                       | 10.12.0 | Flat config, `eslint.config.js`                          |
| Vitest / @vitest/coverage-v8 | 5.0.3   | Projects: `unit`, `architecture`                         |
| Prettier                     | 3.9.10  |                                                          |
| Zod                          | 4.6.6   | Runtime dependency of `contracts` only                   |
| @types/node                  | 24.x    | Root tooling and repository tests only, never `packages` |

All versions are pinned exactly, and CI installs with `--frozen-lockfile`.

### ADR-006: Core uses the WHATWG `URL` class through a minimal declaration

URL parsing must match the browser's exactly, including IDN hosts, default ports, percent-encoding
and dot segments. Every runtime core targets (Chrome extension contexts, web pages, Node.js 24)
provides the WHATWG `URL` class. Enabling the `DOM` or Node.js type libraries would also expose
`window`, `document` and `fs`, so `packages/core/src/platform.d.ts` instead declares only the four
`URL` members core reads. Query strings are parsed by hand, so `URLSearchParams` is not needed.

### ADR-007: Unavailable data is `null`, never guessed

Capture sources differ in what they report. For example, webRequest has no body for most
requests, and Playwright has no tab id. Every such field is `T | null` in the contracts, and
detectors lower their confidence instead of assuming a value. Fields are `null` rather than
optional, so serialised sessions always have the same shape.

### ADR-008: Fingerprints are computed from sanitised data only

`requestKey` hashes the sanitised path (tokens and e-mails replaced), the query without sensitive
values, and a hash of the redacted body. FNV-1a is not a cryptographic hash, so this ensures a
fingerprint never encodes a secret. The cost: two requests that differ only in a redacted value are
treated as equivalent. See the residual risks in [security.md](security.md).

## The Chrome extension (`apps/extension`)

```
 web page tab                service worker (background.js)                 extension pages
 ────────────               ───────────────────────────────                ───────────────
 fetch/XHR ──webRequest──►  RequestTracker ─► CaptureController            popup/   dashboard (panel/)
 navigation ─webNavigation─►   (one queue)       │ normalizeRequest           │            │
                                                 ▼ (redaction)                │  read-only │
                                          SessionRepository ──► chrome.storage.local ◄──────┘
                                                 ▲                            │
                            handleMessage ◄──────┴── validated commands ◄─────┘ (sendCommand)
```

| Folder        | Contents                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `background/` | `service-worker.ts` (listener wiring), `request-tracker.ts`, `capture-controller.ts`, `message-handler.ts` |
| `shared/`     | Message and state schemas, sender check, origin helpers, chrome.storage adapter, command client            |
| `popup/`      | Start and stop capture, site-access status                                                                 |
| `panel/`      | Dashboard: sessions, findings, requests, rules, permissions and limits, export                             |
| `ui/`         | Pure filter and grouping helpers, styles                                                                   |
| `scripts/`    | Manifest policy and validator (Node.js)                                                                    |

Analysis runs in the dashboard: it is a pure function of the stored session and rule set, so
findings always reflect the current rules.

### ADR-009: Capture with `chrome.webRequest`; DevTools panel evaluated and deferred

| API                                       | Gives                                                                                                                                       | Missing or costs                                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `chrome.webRequest` (observe)             | Every request in a tab, while DevTools is closed. Tab, frame, documentId, initiator, status, error, timestamps, form and raw request bodies | Response bodies, the Content-Type header (without `extraHeaders`), and the distinction between fetch and XHR |
| `chrome.devtools.network`                 | HAR entries with bodies and precise timings                                                                                                 | Works only while DevTools is open on that tab                                                                |
| Page instrumentation (patching fetch/XHR) | Everything the page sees                                                                                                                    | Invasive, CSP-dependent, can change page behaviour                                                           |

`webRequest` covers every rule in Phase 2 without invasive instrumentation, and it works while a
tester uses the site normally. A DevTools panel that feeds HAR entries in as the
`extension-devtools` capture source is a possible later addition. The `devtools/` folder from the
original plan is therefore not created.

### ADR-010: The service worker is the only writer

Pages read `chrome.storage.local` directly but send every change to the service worker as a
validated command: triage, delete, clear, and saving rules. Repository operations are serialised
per instance. Two writers in different contexts could interleave read-modify-write updates, for
example a dashboard triage write racing a request append, and corrupt a session's chunk count.
`CaptureController.exclusive` runs those mutations in the same queue as capture events, after
flushing buffered requests.

### ADR-011: Host access is optional, per origin, and requested at capture time

The manifest declares no `host_permissions`. Instead:

- `optional_host_permissions` lists `http://*/*` and `https://*/*`.
- The popup requests access only for the captured origins, inside the click handler, because
  Chrome requires a user gesture.
- The worker re-checks the grant with `chrome.permissions.contains` before it starts.
- The dashboard lists the grants and can revoke them.

The E2E build alone pre-grants `http://127.0.0.1/*`, because automated browsers cannot click the
prompt. `scripts/manifest-policy.ts` fails any other difference.

### ADR-012: Surviving service-worker suspension

- **Listeners:** registered synchronously at the top level, so an event that wakes the worker is
  delivered.
- **Capture state:** `{ sessionId, tabId, origins }` lives in `chrome.storage.session`. The
  controller loads it before handling any event.
- **In-flight requests:** kept in memory only. If the worker restarts mid-request, the completion
  still produces a record, with the body and duration marked unavailable instead of guessed.
- **Writes:** buffered for at most 250 ms or 50 requests.
- **Browser restarts:** these clear session storage, which ends the capture. The recorded session
  is kept.

### ADR-013: Sessions are stored in chunks

A session is stored as several `chrome.storage.local` keys:

- an index;
- one metadata record;
- requests in chunks of 250.

An append rewrites the last chunk and the metadata, never the whole session. Every read is
validated against the contract schemas, and a corrupt chunk is reported rather than trusted.

### ADR-014: No React Vite plugin

Vite 8 compiles TSX with Oxc and the automatic JSX runtime. `@vitejs/plugin-react` mainly adds hot
reload, which an extension production build does not use, so it is not a dependency.

### Deviations from the planned layout

| Planned                           | Actual                                           | Why                                                |
| --------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| `apps/extension/src/devtools/`    | Not created                                      | ADR-009                                            |
| `apps/extension/src/permissions/` | `shared/origins.ts` and the popup                | Too small for its own module                       |
| `apps/extension/src/storage/`     | `packages/storage` plus `shared/chrome-store.ts` | Shared with the runner (Phase 4)                   |
| `apps/extension/src/content/`     | Not created                                      | No content scripts; nothing is injected into pages |
| `apps/extension/public/`          | Not needed                                       | The manifest is emitted by the build               |

## The regression runner (`apps/runner`)

```
Playwright test ─► apiQa fixture ─► NetworkRecorder (CDP session per page)
                                       │ Network.* / Page.* events
                                       ▼
                                  CdpAssembler ─► raw observations (same shape as the extension's)
                                       │
                         buildSession (normalizeRequest: redaction, fingerprints)
                                       ▼
                          analyzeRequests ─► compareWithBaseline ─► writeReports
```

| Folder           | Contents                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `src/capture/`   | `cdp-assembler.ts` (pure, unit-tested), `recorder.ts` (Playwright CDP glue), `session.ts` |
| `src/fixtures/`  | The `apiQa` fixture, assertion helpers, the baseline store, and the controlled test app   |
| `src/reporters/` | Writes sanitised JSON, HTML and CSV reports and attaches them to Playwright results       |
| `src/scenarios/` | The 14 required scenarios (see testing-strategy.md)                                       |
| `rules/`         | Rule sets that scenarios select with `test.use({ rules: '<name>' })`                      |
| `baselines/`     | Committed baselines; `baselines/invalid/` holds deliberately broken fixtures              |

### ADR-015: The runner captures through CDP, not `page.on('request')`

Playwright's request events do not say which document issued a request. CDP's
`Network.requestWillBeSent` carries the issuing document's `loaderId`, and `Page.frameNavigated`
and `Page.navigatedWithinDocument` distinguish new documents from history-API route changes.
This gives the runner the same document attribution as the extension's `documentId`, so every
detector works identically in both.

The cost is that the runner is Chromium-only. The extension is tested separately, through its
real `chrome.webRequest` path, in `tests/e2e`.

Only the Content-Type request header is read, to classify the body. No other header is read or
kept.

### ADR-016: Route-change leaks in single-page apps

In a real browser a replaced document's timers stop, so stale requests after a full navigation
are rare. The common leak is a single-page app whose polling outlives a route.
`navigation.routeChanges` reports an endpoint that repeated on the old route and is still called
after a same-document navigation.

- **Opt-in.** App-wide pollers legitimately span routes, so the check is off by default.
- **Medium confidence**, because it is a heuristic.
- **Exemption.** Endpoints with a polling policy are exempt.

### ADR-017: Fixed test-app port and a separate process

- **Fixed port.** Baselines contain endpoint origins, so the test app listens on a fixed port,
  `127.0.0.1:47130` by default. Override it with `API_QA_TEST_APP_PORT`; recorded baselines then
  need updating.
- **Separate process.** The app runs as its own process through Playwright's `webServer`. When it
  ran inside the runner process, a busy runner delayed responses by up to 20 s.

### ADR-018: One Playwright worker for the runner

On the development machine (12 cores), the suite ran fastest with one worker: 17.9 s against
20.1 s with three. With several workers, Chromium instances starting at the same time stalled each
other's first requests by around 10 s. That is slower and a source of flakiness. The extension
suite also uses one worker, because it needs one persistent browser profile.

### ADR-019: Absolute floor for timing regressions

`regression.durationToleranceMs` (default 50 ms) must be exceeded as well as the relative
tolerance. Otherwise endpoints that answer in a few milliseconds report "regressions" from jitter.
The runner's baseline scenarios do not judge timing at all, because loopback durations under test
load are noise.
