# Detection rules

The analysis engine lives in `@api-qa/core`. It is pure and deterministic: the same requests,
navigations and rule set always produce the same findings in the same order, whatever order the
input arrives in.

```
raw capture ──normalizeRequest──► CapturedRequest ──analyzeRequests──► findings + endpoint stats
                                                                          │
                                       Baseline ◄──createBaseline─────────┤
                                           └──────compareWithBaseline─────┴──► RegressionResult
```

## 1. Normalisation

`normalizeRequest(raw, options)` turns raw capture input into a sanitised `CapturedRequest`, or
rejects it with a reason. Adapters count rejections in `droppedRequestCount`, so a request is
never dropped silently.

| Rejection            | When                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| `invalid-timestamp`  | Not a finite, non-negative number                                         |
| `unsupported-method` | Not an RFC 9110 method after trimming and upper-casing                    |
| `invalid-url`        | The WHATWG URL parser rejects it                                          |
| `unsupported-scheme` | Not `http:` or `https:` (for example `ws:`, `data:`, `chrome-extension:`) |
| `url-too-long`       | URL, sanitised URL or endpoint is longer than 16,384 characters           |

### URL handling

- Credentials (`user:pass@`) and fragments are dropped. Hosts are lower-cased and default ports
  removed.
- Path segments are classified:

| Segment                                                                     | Stored path  | Endpoint template |
| --------------------------------------------------------------------------- | ------------ | ----------------- |
| digits: `42`                                                                | kept         | `:id`             |
| 16–31 hex digits with a digit, such as a Mongo ObjectId                     | kept         | `:id`             |
| UUID                                                                        | kept         | `:uuid`           |
| 32 or more hex digits; JWT; 32 or more mixed-case alphanumerics with digits | **`:token`** | `:token`          |
| contains `@` or `%40`                                                       | **`:email`** | `:email`          |
| anything else                                                               | kept         | kept              |

- Query parameters whose names are sensitive have their values replaced with `[REDACTED]`. Names
  are compared after lower-casing and removing separators:
  - **Whole-word matches:** `key`, `code`, `sig`, `sid`, `pwd`, `otp` and similar.
  - **Substring matches:** `token`, `secret`, `password`, `session`, `signature`, `credential`,
    `apikey` and similar.
  - **Your own names:** add more with `normalization.sensitiveNames`.

### Fingerprints

| Field        | Content                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `endpoint`   | `METHOD origin/template`, for example `GET https://shop.test/api/orders/:id/status`. Rules, statistics and baselines count by this. |
| `requestKey` | Hash of method, origin, sanitised path, canonical query and body fingerprint. Equal keys mean equivalent requests.                  |
| `bodyHash`   | Hash of the canonical, redacted body, or `null`                                                                                     |
| `bodyStatus` | `absent`, `captured`, `truncated` or `unavailable`                                                                                  |

The canonical query is sorted, drops `normalization.ignoredQueryParams` (cache busters such as
`_`), and keeps only the name of each sensitive parameter.

Bodies are canonicalised before hashing:

- **JSON:** keys are sorted and sensitive fields redacted at any depth.
- **Forms:** fields are sorted and sensitive fields redacted.
- **Other text:** hashed as is.

Some bodies are not hashed at all. Their status becomes `truncated`:

- bodies over `maxBodyLength` (1 MiB by default);
- JSON nested more than 64 levels deep.

**Identical URLs are not assumed to be identical operations.** Two POSTs to the same URL with
different bodies have different keys. Equivalence is also always scoped to one tab and one
document.

## 2. Detectors

Each finding has:

- **Severity** (`critical` to `info`), which reflects impact, not the repetition count alone.
- **Confidence** (`high`, `medium`, `low`), which reflects how complete the evidence is.

Finding ids are stable for the same session and rule set, so triage decisions (`confirmed`,
`expected`, `ignored`) survive re-analysis.

### Which requests are analysed

1. Requests are sorted by time, then id.
2. Only `resourceTypes` are kept (default `["api"]`). Requests whose type is unknown are always
   kept.
3. Requests matched by an `excluded` endpoint rule are removed from every detector.

### Rule A: duplicate requests (`duplicate-request`)

**Reports:** requests with the same `requestKey`, tab and document, where each request starts
within `duplicates.windowMs` (default 1000 ms) of the previous one. Steady repetition therefore
forms one group.

**Not reported:**

- retry attempts (rule C);
- requests covered by a polling policy (rule B);
- requests that differ in query values, resource ids or body.

| Method                    | Severity                                   |
| ------------------------- | ------------------------------------------ |
| POST, PATCH, CONNECT      | high: every copy may create or change data |
| PUT, DELETE               | medium: idempotent, but copies race        |
| GET, HEAD, OPTIONS, TRACE | low, or medium from 5 copies (load)        |

**Confidence** starts at high and is lowered when evidence is missing:

- to medium if the document is unknown;
- to low if the method carries a body and a body was `unavailable` or `truncated`.

### Rule B: excessive polling (`excessive-polling`)

**Applies only** to endpoints with a configured policy: `match`, `expectedIntervalMs`,
`tolerance`.

**Reports:** a page whose median interval is below `expectedIntervalMs × (1 − tolerance)`. Using
the median means one-off timer jitter does not trigger a report.

**Severity:** high when the page polls at least 4× too often, otherwise medium.

**Confidence:** high with 4 or more intervals, medium with 2–3, low with 1.

### Rule C: retry loops (`retry-loop`)

**What counts as a retry:**

- A failure is a network error or an HTTP status of 400 or above. An unknown status is not a
  failure.
- An equivalent request that starts within `retries.windowMs` (default 60 s) of a failure is a
  retry of it.
- Chains are built per tab, document and `requestKey`.

**Within policy (not reported):** a chain that stays within `maxAttempts`. An endpoint rule can
override the limit with `maxRetryAttempts`, and `minDelayMs` sets the shortest acceptable gap
between attempts.

**Reported:**

| Situation                                            | Severity and confidence |
| ---------------------------------------------------- | ----------------------- |
| More attempts than allowed, and it never succeeded   | high / high             |
| More attempts than allowed, but it finally succeeded | medium / medium         |
| Attempts closer together than `minDelayMs`           | medium / medium         |

Retry attempts never count as duplicates, and they count as one call for rule D.

### Requests after navigation (`request-after-navigation`)

**Reports:** a request whose document had already been replaced by a newer top-level document in
the same tab, more than `navigation.graceMs` (default 100 ms) after that navigation. Typical causes
are timers, polling or retries that outlive a page.

**Skipped:**

- requests without a tab or document id;
- documents whose navigation was not captured;
- iframes and same-document (history API) route changes.

Back-navigation to a cached document is handled: that document is current again, so its requests
are not reported.

#### Route changes in single-page apps (`navigation.routeChanges`, off by default)

A navigation whose document id equals the previous navigation's in the same tab is a
same-document (history API) route change.

- **Reports:** an endpoint called at least twice on the old route and again after the change
  (plus `graceMs`), before the next navigation. Severity medium, confidence medium.
- **Exempt:** endpoints covered by a polling policy, because they are declared app-wide pollers.
- **Capture sources:** the runner reports route changes through CDP. The extension records full
  navigations only.

### Rule D: endpoint rules

| Field                  | Finding when broken                                                              |
| ---------------------- | -------------------------------------------------------------------------------- |
| `forbidden`            | `forbidden-endpoint` (high)                                                      |
| `required`             | `missing-required-endpoint` (high)                                               |
| `expectedCount`        | `unexpected-call-count`: high if expected calls never happened, otherwise medium |
| `minCount`, `maxCount` | `unexpected-call-count`                                                          |
| `excluded`             | Requests are ignored everywhere                                                  |
| `maxRetryAttempts`     | Overrides rule C's limit                                                         |

Contradictory rules are rejected when the file is loaded. For example, `forbidden` cannot be
combined with `required` or counts, and `minCount` cannot exceed `maxCount`.

If the capture dropped requests, a missing call is reported with **medium** confidence.

With `strictEndpoints: true`, API calls that no endpoint rule or polling policy covers are
reported as `unexpected-endpoint` (low).

**Patterns** take one of two forms:

- a path: `/api/users/:id`;
- an origin plus a path: `https://*.example.com/v1/**`.

| Token   | Matches                         |
| ------- | ------------------------------- |
| `:name` | exactly one non-empty segment   |
| `*`     | any characters within a segment |
| `**`    | zero or more whole segments     |

A `*` in the origin matches any characters. Query strings are not part of a pattern, and trailing
slashes are significant. Matching uses a dynamic-programming matcher, not a regular expression
built from the pattern, so a hostile rule file cannot cause catastrophic backtracking.

### Rule E: regression against a baseline

`createBaseline(analysis, { name, createdAt })` records:

- per-endpoint request counts, failure counts and p50/p95 durations;
- the (type, endpoint) keys of existing findings.

`compareWithBaseline(analysis, baseline, ruleSet)` reports:

| Finding                       | When                                                                                                                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `regression-new-endpoint`     | Endpoint absent from the baseline                                                                                                                                                                   |
| `regression-missing-endpoint` | Baseline endpoint not called. Disable with `reportMissingEndpoints: false`                                                                                                                          |
| `regression-request-count`    | Count above `baseline + max(countToleranceAbsolute, ceil(baseline × countToleranceRatio))`. High if doubled                                                                                         |
| `regression-failure-rate`     | Failure rate rose by more than `failureRateTolerance`                                                                                                                                               |
| `regression-duration`         | p95 above `baseline × (1 + durationToleranceRatio)` **and** more than `durationToleranceMs` (default 50 ms) above the baseline. Only when both sides have timing; confidence is low under 5 samples |
| `regression-new-finding`      | A finding whose (type, endpoint) the baseline did not have                                                                                                                                          |

`passed` is `true` only when there are no regression findings. Baselines loaded from disk must
pass `parseBaseline`.

## 3. Rule files

Rule files are JSON documents validated by `parseRuleSet`, which accepts JSON text or a parsed
value:

- Unknown keys are rejected, which catches typos and `__proto__` smuggling.
- Every number and list is bounded.
- Error messages name the failing path, never the offending value.

See [`examples/test-rules/`](../examples/test-rules). Every file there is validated by the
integration suite.

## Known limitations

- `api` covers XHR and fetch together, because Chrome's webRequest reports both as
  `xmlhttprequest`.
- Polling is judged on the median interval only, so a single double-fire inside a polled endpoint
  is not reported (`shortestIntervalMs` is in the evidence).
- Single-page-app route changes do not replace the document, so requests that continue after one
  are not detected.
- Duplicate detection depends on the capture source supplying the body. Without it, confidence for
  POST/PUT/PATCH/DELETE drops to low.
- Unredacted parameter values that happen to be sensitive, but have innocent names, are not
  detected. Add their names to `sensitiveNames`.
