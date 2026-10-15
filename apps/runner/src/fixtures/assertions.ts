import type { Finding, FindingType, RegressionResult, Severity } from '@api-qa/contracts';
import { SEVERITY_RANK, type AnalysisResult } from '@api-qa/core';

export function findingsOfType(analysis: AnalysisResult, type: FindingType): Finding[] {
  return analysis.findings.filter((finding) => finding.type === type);
}

function describe(findings: readonly Finding[]): string {
  return findings
    .map(
      (finding) =>
        `  - [${finding.severity}/${finding.confidence}] ${finding.type}: ${finding.title}` +
        (finding.endpoint === null ? '' : `\n      ${finding.endpoint}`),
    )
    .join('\n');
}

/**
 * Fails with a readable list when the analysis has findings at or above
 * `minimum` severity. Pass a lower minimum to be stricter.
 */
export function expectNoFindings(analysis: AnalysisResult, minimum: Severity = 'low'): void {
  const relevant = analysis.findings.filter(
    (finding) => SEVERITY_RANK[finding.severity] <= SEVERITY_RANK[minimum],
  );
  if (relevant.length > 0) {
    throw new Error(
      `Expected no API findings of severity ${minimum} or above, found ${String(relevant.length)}:\n${describe(relevant)}`,
    );
  }
}

/** Fails with a readable list when the run regressed against its baseline. */
export function expectNoRegressions(regression: RegressionResult): void {
  if (!regression.passed) {
    throw new Error(
      `API behaviour regressed against baseline "${regression.baselineName}" ` +
        `(${String(regression.findings.length)} finding(s)):\n${describe(regression.findings)}`,
    );
  }
}
