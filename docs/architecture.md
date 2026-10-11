# Architecture

API QA Inspector is a pnpm monorepo. A Chrome extension (manual testing) and a Playwright
runner (automated regression testing) share one analysis engine.

## Workspace layout

| Path                  | Status (Phase 2)               | Responsibility                                                   |
| --------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `packages/contracts`  | Implemented                    | Types, Zod runtime schemas, size limits, safe parsing            |
| `packages/core`       | Implemented                    | Normalisation, redaction, fingerprints, detectors A–E, baselines |
| `packages/storage`    | Not created yet (Phase 3)      | Persistence adapters, session lifecycle and retention            |
| `packages/reporting`  | Not created yet (Phase 3 to 5) | Sanitised JSON, CSV and HTML reports                             |
| `apps/extension`      | Not created yet (Phase 3)      | MV3 capture, messaging, React UI                                 |
| `apps/runner`         | Not created yet (Phase 4)      | Playwright fixtures, scenarios, baseline comparison              |
| `tests/architecture`  | Active                         | Repository-wide rules, such as package import boundaries         |
| `tests/integration`   | Active                         | Full pipeline across packages; example rule files                |
| `tests/security`      | Active                         | Redaction canaries, hostile rule files                           |
| `examples/test-rules` | Active                         | Example rule sets, validated by the integration suite            |

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
