import type { SanitizedReport } from '@api-qa/contracts';

import { formatTimestamp } from './build.js';

type Cell = string | number | boolean | null;

/** Characters that make spreadsheet applications evaluate a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * One RFC 4180 cell. Text that a spreadsheet would run as a formula (CSV
 * injection) is prefixed with an apostrophe; numbers are left alone.
 */
export function csvCell(value: Cell): string {
  if (value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    return String(value);
  }
  const text = FORMULA_START.test(value) ? `'${value}` : value;
  return `"${text.replace(/"/g, '""')}"`;
}

/** Byte-order mark: makes spreadsheet applications read the file as UTF-8. */
const BOM = String.fromCodePoint(0xfeff);

function toCsv(header: readonly string[], rows: readonly (readonly Cell[])[]): string {
  return `${BOM}${[header.map(csvCell), ...rows.map((row) => row.map(csvCell))]
    .map((cells) => cells.join(','))
    .join('\r\n')}\r\n`;
}

/** One row per finding. */
export function findingsToCsv(report: SanitizedReport): string {
  return toCsv(
    [
      'id',
      'type',
      'severity',
      'confidence',
      'triage',
      'title',
      'endpoint',
      'request_count',
      'first_seen',
      'last_seen',
      'reasoning',
    ],
    report.findings.map((finding) => [
      finding.id,
      finding.type,
      finding.severity,
      finding.confidence,
      finding.triage,
      finding.title,
      finding.endpoint,
      finding.evidence.requestCount,
      formatTimestamp(finding.evidence.firstTimestamp),
      formatTimestamp(finding.evidence.lastTimestamp),
      finding.reasoning,
    ]),
  );
}

/** One row per endpoint. */
export function endpointsToCsv(report: SanitizedReport): string {
  return toCsv(
    ['endpoint', 'requests', 'failures', 'timed_requests', 'p50_ms', 'p95_ms'],
    report.endpoints.map((stats) => [
      stats.endpoint,
      stats.requestCount,
      stats.failureCount,
      stats.timedRequestCount,
      stats.durationP50Ms,
      stats.durationP95Ms,
    ]),
  );
}
