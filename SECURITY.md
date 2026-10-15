# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability** on this repository.
Include:

- the affected component (extension, runner, engine, or release tooling);
- the version, or the commit;
- steps to reproduce;
- the impact you expect.

You should receive an acknowledgement within 5 working days and a fix or mitigation plan within
30 days. Reporters are credited in the release notes unless they prefer otherwise.

## Supported versions

Only the latest released version receives security fixes.

## Scope

Examples of what counts as a vulnerability:

- captured data leaving the browser or the test machine;
- secrets surviving redaction into storage, baselines or reports;
- a web page triggering extension commands;
- script execution from captured content or exported reports;
- unsafe handling of imported rule or baseline files;
- weaknesses in the release pipeline.

The extension's privacy model and threat model are described in
[docs/security.md](docs/security.md).
