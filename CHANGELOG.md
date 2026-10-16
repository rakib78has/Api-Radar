# Changelog

All notable changes to this project are documented here. Versions follow
[Semantic Versioning](https://semver.org/).

From 0.1.0 on, this file is maintained by
[release-please](https://github.com/googleapis/release-please). New entries are generated from
[Conventional Commit](https://www.conventionalcommits.org/) pull-request titles, so don't edit
upcoming entries by hand. Change the PR title instead (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## [0.1.0] - 2026-10-15

First release: a Chrome extension for manual API QA and a Playwright runner for automated
regression testing, sharing one analysis engine.

### Added

- **Analysis engine** (`@api-qa/core`). It detects:
  - duplicate requests, rated by impact;
  - excessive polling against configured policies;
  - uncontrolled retry loops;
  - requests from pages the user had left, including polling that survives a single-page-app
    route change (opt-in);
  - required, forbidden and counted endpoints, plus a strict-endpoint mode;
  - regressions against a recorded baseline.

  All detection is deterministic, with severity based on impact and explicit confidence.

- **Privacy by default.** Credentials, fragments, sensitive query values, token and e-mail path
  segments, and sensitive body fields are redacted before anything is stored. Bodies are reduced
  to fingerprints, and headers and cookies are never read.
- **Chrome extension** (Manifest V3).
  - Captures one tab with `chrome.webRequest`. Host access is optional and granted per origin.
  - Messages from extension pages are validated.
  - Dashboard: findings with evidence, filters, triage, a request table, a rule editor,
    permissions and limitations, and HTML, JSON and CSV export.
- **Playwright regression runner.** CDP capture with document attribution, an `apiQa` fixture,
  committed baselines, sanitised reports attached to test results, and 14 scenarios against a
  controlled local test app.
- **Security tooling.**
  - Strict, size-bounded validation of every imported file.
  - Injection-safe CSV and script-free HTML reports.
  - A manifest and bundle policy validator.
  - Secret scanning, a lockfile policy check, dependency audit and review, and CodeQL.
- **Release tooling.**
  - Reproducible extension icons.
  - A deterministic, validated zip with SHA-256 checksums.
  - Build provenance attestation.
  - A draft GitHub release for manual review.
