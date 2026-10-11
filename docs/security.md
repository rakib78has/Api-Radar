# Security and privacy

> **Scope (Phase 2).** This covers the shared engine (`@api-qa/contracts`, `@api-qa/core`). The
> extension's permission model, CSP and storage are added in Phase 3. The release and
> supply-chain controls are added in Phase 5.

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

## Residual risks

- **Fingerprints use FNV-1a 64, which is not cryptographic.** The engine therefore hashes only
  sanitised data. A body hash still covers non-sensitive fields such as a username. Someone with
  the report who can guess every other field of a body could confirm a guess. Phase 5 will decide
  whether to switch to SHA-256 (asynchronous WebCrypto).
- **Plain-text bodies (neither JSON nor form) are hashed without redaction.** They are never
  stored, but the hash covers their full text.
- **Name-based redaction cannot catch a secret under an innocent name** (for example
  `?q=<token>`). Testers can add names with `normalization.sensitiveNames`.
- **Zod and the extension CSP.** Zod 4 speeds up parsing with `new Function` when it is allowed.
  Under the Manifest V3 CSP that is blocked and Zod falls back to normal parsing. The extension
  should set `z.config({ jitless: true })` so the fallback is explicit (Phase 3).
