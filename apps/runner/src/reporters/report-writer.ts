import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CaptureSession, RegressionResult, SanitizedReport } from '@api-qa/contracts';
import type { AnalysisResult } from '@api-qa/core';
import {
  buildReport,
  endpointsToCsv,
  findingsToCsv,
  reportToHtml,
  reportToJson,
} from '@api-qa/reporting';

export interface ReportFiles {
  readonly report: SanitizedReport;
  readonly json: string;
  readonly html: string;
  readonly findingsCsv: string;
  readonly endpointsCsv: string;
}

export interface WriteReportInput {
  readonly session: CaptureSession;
  readonly analysis: AnalysisResult;
  readonly regression: RegressionResult | null;
  readonly directory: string;
  readonly toolVersion: string;
  readonly generatedAt: number;
}

/** Writes the sanitised report in every format and returns the file paths. */
export function writeReports(input: WriteReportInput): ReportFiles {
  const built = buildReport({
    session: input.session,
    analysis: input.analysis,
    regression: input.regression,
    generatedAt: input.generatedAt,
    toolVersion: input.toolVersion,
  });
  if (!built.ok) {
    throw new Error(`Could not build the report: ${built.issues.join('; ')}`);
  }
  const report = built.value;
  mkdirSync(input.directory, { recursive: true });
  const files = {
    json: join(input.directory, 'api-qa-report.json'),
    html: join(input.directory, 'api-qa-report.html'),
    findingsCsv: join(input.directory, 'api-qa-findings.csv'),
    endpointsCsv: join(input.directory, 'api-qa-endpoints.csv'),
  };
  writeFileSync(files.json, reportToJson(report));
  writeFileSync(files.html, reportToHtml(report));
  writeFileSync(files.findingsCsv, findingsToCsv(report));
  writeFileSync(files.endpointsCsv, endpointsToCsv(report));
  return { report, ...files };
}
