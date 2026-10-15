# Security and privacy

> **Scope (Phase 3).** This covers the shared engine, storage, reports and the Chrome extension.
> Release and supply-chain controls (dependency audit, secret scanning, signed artifacts) are
> added in Phase 5.

## Principles

- **Local first.** Nothing in the engine performs I/O. It cannot upload anything.
- **Sanitise at the boundary.** Raw capture input (`RawRequestObservation`) is held in memory only.
  The first thing a capture adapter does is call `normalizeRequest`. Only its sanitised output may
  be stored, exported or compared.
- **No headers, cookies or bodies are stored.** `CapturedRequest` has no field for them. A body
  contributes only a hash of its redacted, canonical form.
- **Untrusted files are validated.** Rule files, baselines, sessions and reports are parsed with
  strict, size-bounded schemas.

## What is redacted

| Channel                                        | Treatment                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| URL credentials (`user:pw@`)                   | Dropped                                                            |
| URL fragment                                   | Dropped                                                            |
| Sensitive query values                         | Replaced with `[REDACTED]`, excluded from fingerprints (name only) |
| Token-like path segments                       | Replaced with `:token`                                             |
| E-mail path segments                           | Replaced with `:email`                                             |
| JSON and form body fields with sensitive names | Redacted before hashing; the body itself is never kept             |
| Truncated or over-deep bodies                  | Not hashed at all                                                  |
| URLs inside error messages                     | Replaced with `[URL]`                                              |
| Initiator                                      | Reduced to its origin                                              |
| Navigation URLs                                | Same as request URLs; non-http(s) URLs are reduced to their scheme |

`tests/security/redaction.test.ts` plants a unique canary value in each channel. It then asserts
that none appears, raw or percent-encoded, in the serialised session, analysis, baseline or
regression result. The test was mutation-checked: disabling query redaction and error-URL
redaction makes it fail for exactly the affected canaries.

## Untrusted input

| Threat                                                  | Control                                                                                 |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Oversized documents                                     | `parseJsonDocument` rejects anything over 20 Mi characters before parsing               |
| Oversized arrays, strings and numbers                   | Every schema field has a bound (`LIMITS` in `@api-qa/contracts`)                        |
| Typos and prototype smuggling (`__proto__`)             | `strictObject` schemas reject unknown keys                                              |
| Error messages leaking file content                     | JSON syntax errors become a generic message; schema issues name the path, not the value |
| Regular-expression denial of service                    | Patterns are matched by a dynamic-programming matcher with no regex built from input    |
| Inherited-property lookups (`__proto__`, `constructor`) | Lookups from untrusted names use `Map`, never object literals                           |
| Deeply nested JSON bodies                               | Canonicalisation stops at depth 64                                                      |

## The Chrome extension

### Permissions

| Permission                  | Why                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `webRequest`                | Observe requests. Observe only: the extension never blocks or modifies traffic                            |
| `webNavigation`             | Record top-level navigations for the request-after-navigation detector                                    |
| `storage`                   | Keep sessions and settings on this device                                                                 |
| `activeTab`                 | Read the current tab's URL when the popup opens, without `tabs`                                           |
| `optional_host_permissions` | `http://*/*`, `https://*/*`, granted one origin at a time when a capture starts. Never granted at install |

There are no `host_permissions`, no content scripts, no `web_accessible_resources`, and no
`externally_connectable`. `pnpm validate:manifest` enforces this and fails the build if any of them
appears.

### Content Security Policy

```
script-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'
```

- **No remote code.** There is no `unsafe-eval` and no remote script source. The validator also
  scans the bundle for network imports and `importScripts`.
- **Zod's JIT is off.** Zod's runtime compiler would need `eval`. It is disabled with
  `z.config({ jitless: true })` in every entry point, so the CSP blocks nothing at runtime.

### Who can issue commands

- **Pages:** extension pages read storage directly, but every change goes to the service worker as
  a command.
- **Sender check:** the worker accepts a command only if `sender.id` is this extension and
  `sender.url` starts with its own `chrome-extension://<id>/` origin. Anything else is ignored.
- **Validation:** commands are validated with strict schemas. Origins must be exact http(s)
  origins, tab ids must be non-negative, and ids must match the identifier pattern. Unknown or
  malformed commands are refused.
- **No way in from the web:** web pages have no route to the worker, because there is no
  `externally_connectable` and no content script. The E2E suite checks that `chrome.runtime` is not
  exposed to pages.
- **Permission re-check:** a capture starts only after the worker confirms the host grant with
  `chrome.permissions.contains`.

### What is captured

- **Scope:** only the tab the user chose, and only origins they granted.
- **Recorded fields:** method, sanitised URL, resource type, status, network error (with URLs
  removed), approximate duration, initiator origin, and tab, frame and document ids.
- **Bodies:** form data and raw upload bytes are read only to compute the redacted body
  fingerprint, then discarded. File uploads are never read.
- **Never read:** headers and cookies are never requested (no `extraHeaders`, no
  `requestHeaders`).

### Storage, retention and deletion

- **Where:** sessions live in `chrome.storage.local` and capture state in `chrome.storage.session`.
  Both are reachable only from trusted extension contexts.
- **Validation:** every stored record is validated when read. Corrupt data is reported, never used.
- **Retention:** applied after every capture (default: 20 sessions, 30 days). A running capture is
  never pruned.
- **Deletion:** the dashboard deletes one session or all data. Uninstalling the extension removes
  everything.

### Exports

Reports contain sanitised findings and endpoint statistics only, never the request list.

| Format | Protection                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------- |
| HTML   | Every value escaped; embedded CSP `default-src 'none'`; no scripts, forms or remote resources      |
| CSV    | RFC 4180 quoting; cells starting with `= + - @ Tab CR` prefixed with `'` against formula injection |
| JSON   | Validated against the report schema before writing                                                 |

### The regression runner

- **What is read.** CDP events for the test's own page. Only the Content-Type request header is
  read, to classify bodies; no other header and no cookie is read.
- **Redaction.** Captured traffic goes through the same normalisation and redaction as the
  extension before it is analysed, stored in a baseline or reported. Scenario 12 plants four
  secrets and checks every output.
- **Artifacts.** Reports and JUnit files come from the local test app only, and are sanitised.
  Baselines contain endpoint templates, counts and timings, never URLs with query values.

### Threat model

| Threat                                            | Mitigation                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A captured site steals data through the extension | No content scripts or exposed resources; pages cannot message the worker                         |
| Captured content executes in the dashboard        | React escapes all text. Captured data is never used as HTML, URLs to navigate to, or code        |
| Captured content executes in an exported report   | Escaping, CSP and no scripts (HTML); formula neutralisation (CSV)                                |
| Another extension sends commands                  | Sender id and URL check                                                                          |
| A malicious rule file                             | Size-bounded strict schema; matcher without regex backtracking; 1 MiB import cap                 |
| Corrupt or tampered storage                       | Schema validation on every read                                                                  |
| Secrets persisted by accident                     | Redaction before storage; canary tests in unit, integration and E2E suites                       |
| Over-broad access                                 | Optional per-origin hosts, revocable from the dashboard                                          |
| Supply chain                                      | Exact pinned versions, frozen lockfile, SHA-pinned actions. Audit and scanning follow in Phase 5 |

## Residual risks

- **Fingerprints use FNV-1a 64, which is not cryptographic.** The engine therefore hashes only
  sanitised data. A body hash still covers non-sensitive fields such as a username. Someone with
  the report who can guess every other field of a body could confirm a guess. Phase 5 will decide
  whether to switch to SHA-256 (asynchronous WebCrypto).
- **Plain-text bodies (neither JSON nor form) are hashed without redaction.** They are never
  stored, but the hash covers their full text.
- **Name-based redaction cannot catch a secret under an innocent name** (for example
  `?q=<token>`). Testers can add names with `normalization.sensitiveNames`.
- **Approximate durations.** webRequest timestamps include queueing. Timing regressions are hints, not proof.
- **Browser profile access.** Anyone with access to the browser profile can read stored, already sanitised sessions. Delete sessions after sensitive testing.
