import type { MeasurementValue, ReportedFinding, SanitizedReport } from '@api-qa/contracts';

import { formatTimestamp } from './build.js';

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes text for HTML element content and quoted attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

/** The report allows no scripts, connections, frames, forms or remote resources. */
export const REPORT_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; form-action 'none'; base-uri 'none'";

const STYLES = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1d1f23; --muted: #5b616b; --line: #d9dde3;
  --panel: #f5f6f8; --critical: #8f1d1d; --high: #b42318; --medium: #b54708; --low: #175cd3; --info: #475467; --ok: #067647; }
@media (prefers-color-scheme: dark) { :root { --bg: #141518; --fg: #e8eaee; --muted: #a2a8b3; --line: #2e3138;
  --panel: #1c1e22; --critical: #ff8a8a; --high: #f97066; --medium: #fdb022; --low: #84adff; --info: #98a2b3; --ok: #47cd89; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 16px 48px; background: var(--bg); color: var(--fg);
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 17px; margin: 32px 0 8px; }
.muted { color: var(--muted); }
dl.summary { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 16px 0;
  padding: 12px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
dl.summary dt { color: var(--muted); } dl.summary dd { margin: 0; overflow-wrap: anywhere; }
.banner { padding: 10px 14px; border-radius: 8px; border: 1px solid var(--line); font-weight: 600; }
.banner.ok { color: var(--ok); } .banner.fail { color: var(--high); }
.table-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 8px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; vertical-align: top; padding: 8px 10px; border-bottom: 1px solid var(--line); }
th { background: var(--panel); font-weight: 600; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td.endpoint, td.reasoning { overflow-wrap: anywhere; min-width: 200px; }
td.num { text-align: right; font-variant-numeric: tabular-nums; }
.sev { font-weight: 700; text-transform: uppercase; font-size: 12px; letter-spacing: .03em; }
.sev-critical { color: var(--critical); } .sev-high { color: var(--high); } .sev-medium { color: var(--medium); }
.sev-low { color: var(--low); } .sev-info { color: var(--info); }
details summary { cursor: pointer; color: var(--muted); }
details dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 6px 0 0; }
details dd { margin: 0; overflow-wrap: anywhere; font-family: ui-monospace, Consolas, monospace; font-size: 12px; }
`;

function measurementText(value: MeasurementValue): string {
  return value === null ? 'n/a' : String(value);
}

function findingRow(finding: ReportedFinding): string {
  const measurements = Object.entries(finding.evidence.measurements)
    .map(
      ([name, value]) =>
        `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(measurementText(value))}</dd>`,
    )
    .join('');
  const ids = finding.evidence.requestIds.map(escapeHtml).join(', ');
  return `<tr>
<td><span class="sev sev-${finding.severity}">${finding.severity}</span></td>
<td>${escapeHtml(finding.type)}</td>
<td><strong>${escapeHtml(finding.title)}</strong><div class="muted">confidence ${finding.confidence} · triage ${finding.triage}</div></td>
<td class="endpoint">${escapeHtml(finding.endpoint ?? '—')}</td>
<td class="num">${String(finding.evidence.requestCount)}</td>
<td class="reasoning">${escapeHtml(finding.reasoning)}<details><summary>Evidence</summary><dl>${measurements}<dt>requests</dt><dd>${ids || 'n/a'}</dd></dl></details></td>
</tr>`;
}

function findingsTable(findings: readonly ReportedFinding[]): string {
  if (findings.length === 0) {
    return '<p class="muted">No findings.</p>';
  }
  return `<div class="table-wrap"><table>
<thead><tr><th>Severity</th><th>Type</th><th>Finding</th><th>Endpoint</th><th>Requests</th><th>Reasoning</th></tr></thead>
<tbody>${findings.map(findingRow).join('')}</tbody></table></div>`;
}

function optionalMs(value: number | null): string {
  return value === null ? '—' : `${String(Math.round(value))} ms`;
}

/**
 * A self-contained HTML report. Every value is escaped, and the embedded
 * Content-Security-Policy forbids scripts, so captured content can never run.
 */
export function reportToHtml(report: SanitizedReport): string {
  const { session, regression } = report;
  const regressionSection =
    regression === null
      ? ''
      : `<h2>Regression against “${escapeHtml(regression.baselineName)}”</h2>
<p class="banner ${regression.passed ? 'ok' : 'fail'}">${
          regression.passed
            ? `Passed: no regressions across ${String(regression.comparedEndpointCount)} endpoints.`
            : `Failed: ${String(regression.findings.length)} regression finding(s).`
        }</p>
${regression.passed ? '' : findingsTable(regression.findings.map((finding) => ({ ...finding, triage: 'open' })))}`;

  const endpointRows = report.endpoints
    .map(
      (stats) => `<tr><td class="endpoint">${escapeHtml(stats.endpoint)}</td>
<td class="num">${String(stats.requestCount)}</td><td class="num">${String(stats.failureCount)}</td>
<td class="num">${optionalMs(stats.durationP50Ms)}</td><td class="num">${optionalMs(stats.durationP95Ms)}</td></tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>API QA report: ${escapeHtml(session.name)}</title>
<style>${STYLES}</style>
</head>
<body>
<main>
<h1>API QA report</h1>
<p class="muted">${escapeHtml(session.name)} · generated ${escapeHtml(formatTimestamp(report.generatedAt))} by ${escapeHtml(report.tool.name)} ${escapeHtml(report.tool.version)}</p>
<dl class="summary">
<dt>Session</dt><dd>${escapeHtml(session.id)}</dd>
<dt>Source</dt><dd>${escapeHtml(session.source)}</dd>
<dt>Started</dt><dd>${escapeHtml(formatTimestamp(session.startedAt))}</dd>
<dt>Ended</dt><dd>${escapeHtml(formatTimestamp(session.endedAt) || 'still capturing')}</dd>
<dt>Requests</dt><dd>${String(session.requestCount)} recorded, ${String(session.droppedRequestCount)} dropped</dd>
<dt>Rule set</dt><dd>${escapeHtml(report.ruleSetName)}</dd>
<dt>Findings</dt><dd>${String(report.findings.length)}</dd>
</dl>
${regressionSection}
<h2>Findings</h2>
${findingsTable(report.findings)}
<h2>Endpoints</h2>
${
  report.endpoints.length === 0
    ? '<p class="muted">No endpoints.</p>'
    : `<div class="table-wrap"><table><thead><tr><th>Endpoint</th><th>Requests</th><th>Failures</th><th>p50</th><th>p95</th></tr></thead><tbody>${endpointRows}</tbody></table></div>`
}
<p class="muted">This report contains sanitised data only: no headers, cookies or bodies. Sensitive query values appear as [REDACTED].</p>
</main>
</body>
</html>
`;
}
