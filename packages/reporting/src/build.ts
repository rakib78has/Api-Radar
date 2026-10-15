import {
  LIMITS,
  parseWith,
  sanitizedReportSchema,
  type CaptureSession,
  type EndpointStats,
  type Finding,
  type ParseResult,
  type RegressionResult,
  type SanitizedReport,
} from '@api-qa/contracts';

/** The parts of an analysis a report needs; `@api-qa/core`'s AnalysisResult satisfies it. */
export interface ReportableAnalysis {
  readonly ruleSetName: string;
  readonly findings: readonly Finding[];
  readonly endpointStats: readonly EndpointStats[];
}

export interface ReportInput {
  readonly session: CaptureSession;
  readonly analysis: ReportableAnalysis;
  readonly regression?: RegressionResult | null;
  readonly generatedAt: number;
  readonly toolVersion: string;
}

/**
 * Assembles a report from sanitised records only (no request list, no
 * headers, no bodies) and validates it against the report schema.
 */
export function buildReport(input: ReportInput): ParseResult<SanitizedReport> {
  const { session, analysis } = input;
  return parseWith(sanitizedReportSchema, {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    tool: { name: 'api-qa-inspector', version: input.toolVersion },
    session: {
      id: session.id,
      name: session.name,
      source: session.source,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      requestCount: session.requests.length,
      droppedRequestCount: session.droppedRequestCount,
    },
    ruleSetName: analysis.ruleSetName,
    findings: analysis.findings.slice(0, LIMITS.findingsPerReport).map((finding) => ({
      ...finding,
      triage: session.triage[finding.id] ?? 'open',
    })),
    endpoints: analysis.endpointStats.slice(0, LIMITS.endpointsPerBaseline),
    regression: input.regression ?? null,
  });
}

/** ISO-8601 UTC, or an empty string for a missing timestamp. */
export function formatTimestamp(timestamp: number | null): string {
  return timestamp === null ? '' : new Date(timestamp).toISOString();
}

/** A download name containing only safe characters, e.g. `api-qa-report-checkout-2026-10-15.csv`. */
export function reportFileName(
  report: SanitizedReport,
  extension: 'json' | 'csv' | 'html',
): string {
  const name =
    report.session.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'session';
  const date = formatTimestamp(report.generatedAt).slice(0, 10);
  return `api-qa-report-${name}-${date}.${extension}`;
}
