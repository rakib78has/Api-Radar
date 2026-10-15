import type { SanitizedReport } from '@api-qa/contracts';

/** Pretty-printed JSON. The report is already sanitised and schema-validated. */
export function reportToJson(report: SanitizedReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}
