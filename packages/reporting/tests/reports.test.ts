import { LIMITS, sanitizedReportSchema, type SanitizedReport } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import {
  REPORT_CSP,
  buildReport,
  csvCell,
  endpointsToCsv,
  escapeHtml,
  findingsToCsv,
  formatTimestamp,
  reportFileName,
  reportToHtml,
  reportToJson,
} from '../src/index.js';
import { HOSTILE, analysis, finding, regression, session } from './fixtures.js';

const GENERATED_AT = Date.UTC(2026, 9, 15, 9, 10, 0);

function report(overrides: Partial<Parameters<typeof buildReport>[0]> = {}): SanitizedReport {
  const result = buildReport({
    session: session(),
    analysis: analysis(),
    generatedAt: GENERATED_AT,
    toolVersion: '0.1.0',
    ...overrides,
  });
  if (!result.ok) {
    throw new Error(result.issues.join('; '));
  }
  return result.value;
}

describe('buildReport', () => {
  it('produces a schema-valid report with triage applied', () => {
    const built = report();
    expect(sanitizedReportSchema.parse(built)).toEqual(built);
    expect(built.findings[0]?.triage).toBe('confirmed');
    expect(built.session).toMatchObject({ requestCount: 0, droppedRequestCount: 1 });
    expect(built.regression).toBeNull();
  });

  it('marks findings without a decision as open', () => {
    expect(report({ session: session({ triage: {} }) }).findings[0]?.triage).toBe('open');
  });

  it('includes a regression result when given', () => {
    expect(report({ regression: regression(false) }).regression?.passed).toBe(false);
  });

  it('rejects an invalid tool version', () => {
    const result = buildReport({
      session: session(),
      analysis: analysis(),
      generatedAt: 0,
      toolVersion: 'dev',
    });
    expect(result.ok).toBe(false);
  });

  it('caps the number of findings', () => {
    const many = Array.from({ length: LIMITS.findingsPerReport + 5 }, () => finding());
    expect(report({ analysis: analysis(many) }).findings).toHaveLength(LIMITS.findingsPerReport);
  });
});

describe('reportToJson', () => {
  it('round-trips through the schema', () => {
    const built = report({ regression: regression(true) });
    expect(sanitizedReportSchema.parse(JSON.parse(reportToJson(built)))).toEqual(built);
  });
});

describe('csvCell', () => {
  it.each([
    [null, ''],
    [42, '42'],
    [-3, '-3'],
    [true, 'true'],
    ['plain', '"plain"'],
    ['say "hi"', '"say ""hi"""'],
    ['a,b\nc', '"a,b\nc"'],
    ['=HYPERLINK("http://evil")', `"'=HYPERLINK(""http://evil"")"`],
    ['+1+1', `"'+1+1"`],
    ['-2+3', `"'-2+3"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['\tcmd', `"'\tcmd"`],
  ])('formats %j as %s', (value, expected) => {
    expect(csvCell(value)).toBe(expected);
  });
});

describe('findingsToCsv and endpointsToCsv', () => {
  it('writes a header and one row per finding, with a UTF-8 BOM and CRLF', () => {
    const csv = findingsToCsv(report());
    expect(csv.startsWith('\uFEFF"id","type"')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"2026-10-15T09:00:00.000Z"');
    expect(lines[1]).toContain('"confirmed"');
  });

  it('neutralises formulas planted in captured data', () => {
    const csv = findingsToCsv(
      report({ analysis: analysis([finding({ endpoint: '=cmd|"/c calc"!A1' })]) }),
    );
    expect(csv).toContain(`"'=cmd|""/c calc""!A1"`);
  });

  it('writes endpoint statistics', () => {
    const lines = endpointsToCsv(report()).slice(1).trimEnd().split('\r\n');
    expect(lines).toEqual([
      '"endpoint","requests","failures","timed_requests","p50_ms","p95_ms"',
      '"POST https://shop.test/api/orders",2,0,2,40,52.4',
    ]);
  });
});

describe('reportToHtml', () => {
  it('escapes every piece of captured text', () => {
    const hostile = finding({
      title: HOSTILE,
      reasoning: HOSTILE,
      endpoint: HOSTILE,
      evidence: { ...finding().evidence, measurements: { [HOSTILE]: HOSTILE } },
    });
    const html = reportToHtml(
      report({ session: session({ name: HOSTILE }), analysis: analysis([hostile]) }),
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toMatch(/<[^>]*onerror=/i);
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  it('embeds a CSP that forbids scripts and remote resources', () => {
    const html = reportToHtml(report());
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="${REPORT_CSP}">`);
    expect(REPORT_CSP).toContain("default-src 'none'");
    expect(REPORT_CSP).not.toContain('script-src');
    expect(html).not.toMatch(/<script|<link|<iframe|<form|https?:\/\/(?!shop\.test)/);
  });

  it('shows the regression verdict', () => {
    expect(reportToHtml(report({ regression: regression(true) }))).toContain(
      'Passed: no regressions',
    );
    const failed = reportToHtml(report({ regression: regression(false) }));
    expect(failed).toContain('Failed: 1 regression finding(s).');
  });

  it('handles an empty report and a session still capturing', () => {
    const html = reportToHtml(
      report({
        session: session({ endedAt: null }),
        analysis: { ruleSetName: 'R', findings: [], endpointStats: [] },
      }),
    );
    expect(html).toContain('No findings.');
    expect(html).toContain('No endpoints.');
    expect(html).toContain('still capturing');
  });

  it('shows missing values plainly', () => {
    const html = reportToHtml(
      report({
        analysis: {
          ...analysis([
            finding({ endpoint: null, evidence: { ...finding().evidence, requestIds: [] } }),
          ]),
          endpointStats: [
            {
              endpoint: 'GET https://shop.test/x',
              requestCount: 1,
              failureCount: 0,
              timedRequestCount: 0,
              durationP50Ms: null,
              durationP95Ms: null,
            },
          ],
        },
      }),
    );
    expect(html).toContain('<td class="endpoint">—</td>');
    expect(html).toContain('<dt>requests</dt><dd>n/a</dd>');
    expect(html).toContain('<td class="num">—</td>');
  });
});

describe('helpers', () => {
  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('formats timestamps as ISO UTC', () => {
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp(0)).toBe('1970-01-01T00:00:00.000Z');
  });

  it('builds safe file names', () => {
    expect(reportFileName(report(), 'csv')).toBe('api-qa-report-checkout-run-2026-10-15.csv');
    expect(reportFileName(report({ session: session({ name: '../../<>' }) }), 'html')).toBe(
      'api-qa-report-session-2026-10-15.html',
    );
  });
});
