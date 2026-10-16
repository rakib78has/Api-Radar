import {
  FINDING_TYPES,
  findingTypeSchema,
  parseBaseline,
  parseCaptureSession,
  parseRuleSet,
  parseWith,
  rawNavigationObservationSchema,
  rawRequestObservationSchema,
  type CaptureSession,
  type RegressionResult,
  type SanitizedReport,
} from '@api-qa/contracts';
import {
  analyzeRequests,
  compareWithBaseline,
  normalizeNavigation,
  normalizeRequest,
  type AnalysisResult,
} from '@api-qa/core';
import {
  buildReport,
  endpointsToCsv,
  findingsToCsv,
  reportToHtml,
  reportToJson,
} from '@api-qa/reporting';
import { z } from 'zod';

/** The four files in examples/seed, already parsed from JSON. */
export interface SeedFiles {
  readonly observations: unknown;
  readonly rules: unknown;
  readonly baseline: unknown;
  readonly expected: unknown;
}

export interface SeedCheck {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface SeedRun {
  readonly session: CaptureSession;
  readonly analysis: AnalysisResult;
  readonly regression: RegressionResult;
  readonly report: SanitizedReport;
  readonly exports: Readonly<Record<'json' | 'html' | 'findingsCsv' | 'endpointsCsv', string>>;
}

export interface SeedResult {
  readonly checks: readonly SeedCheck[];
  /** Absent when the seed files themselves are invalid. */
  readonly run: SeedRun | null;
}

const observationsSchema = z.strictObject({
  description: z.string().optional(),
  navigations: z.array(rawNavigationObservationSchema),
  requests: z.array(rawRequestObservationSchema),
});

const expectedSchema = z.strictObject({
  description: z.string().optional(),
  storedRequests: z.number().int().nonnegative(),
  droppedRequests: z.number().int().nonnegative(),
  // Only the finding types the seed should produce; every other type must not appear.
  findings: z.partialRecord(findingTypeSchema, z.number().int().positive()),
  regressionTypes: z.array(findingTypeSchema),
  secrets: z.array(z.string().min(4)),
  redactedSamples: z.array(z.string().min(1)),
});

function check(name: string, ok: boolean, detail: string): SeedCheck {
  return { name, ok, detail };
}

/**
 * Runs the seed capture through the whole pipeline (normalisation and
 * redaction, analysis, baseline comparison, report export) and compares the
 * outcome with expected.json. Pure apart from Date-free deterministic input.
 */
export function runSeed(files: SeedFiles): SeedResult {
  const observations = parseWith(observationsSchema, files.observations);
  const rules = parseRuleSet(files.rules);
  const baseline = parseBaseline(files.baseline);
  const expected = parseWith(expectedSchema, files.expected);
  const problems = [
    ...(observations.ok ? [] : observations.issues.map((issue) => `observations.json ${issue}`)),
    ...(rules.ok ? [] : rules.issues.map((issue) => `rules.json ${issue}`)),
    ...(baseline.ok ? [] : baseline.issues.map((issue) => `baseline.json ${issue}`)),
    ...(expected.ok ? [] : expected.issues.map((issue) => `expected.json ${issue}`)),
  ];
  if (!observations.ok || !rules.ok || !baseline.ok || !expected.ok) {
    return { checks: [check('Seed files are valid', false, problems.join('; '))], run: null };
  }
  const ruleSet = rules.value;
  const want = expected.value;
  const checks: SeedCheck[] = [
    check('Seed files are valid', true, 'observations, rules, baseline and expectations parse'),
  ];

  // 1. Capture: normalise and redact, exactly as the extension and the runner do.
  const requests = observations.value.requests.flatMap((raw) => {
    const result = normalizeRequest(raw, ruleSet.normalization);
    return result.ok ? [result.request] : [];
  });
  const navigations = observations.value.navigations.flatMap((raw) => {
    const result = normalizeNavigation(raw, ruleSet.normalization);
    return result.ok ? [result.navigation] : [];
  });
  const dropped = observations.value.requests.length - requests.length;
  const parsedSession = parseCaptureSession({
    schemaVersion: 1,
    id: 'seed-shop-workflow',
    name: 'Seed: shop workflow',
    source: 'playwright',
    startedAt: navigations[0]?.timestamp ?? 0,
    endedAt: Math.max(0, ...requests.map((request) => request.timestamp)),
    requests,
    navigations,
    droppedRequestCount: dropped,
    triage: {},
  });
  if (!parsedSession.ok) {
    return {
      checks: [...checks, check('Session is valid', false, parsedSession.issues.join('; '))],
      run: null,
    };
  }
  const session = parsedSession.value;
  checks.push(
    check(
      'Requests stored and dropped',
      requests.length === want.storedRequests && dropped === want.droppedRequests,
      `${String(requests.length)} stored (expected ${String(want.storedRequests)}), ${String(dropped)} dropped (expected ${String(want.droppedRequests)})`,
    ),
  );

  // 2. Analysis: every expected finding type, the expected number of times, nothing else.
  const analysis = analyzeRequests(session, ruleSet);
  for (const type of FINDING_TYPES) {
    const actual = analysis.findings.filter((finding) => finding.type === type).length;
    const wanted = want.findings[type] ?? 0;
    if (actual > 0 || wanted > 0) {
      checks.push(
        check(
          `Finding: ${type}`,
          actual === wanted,
          `${String(actual)} found, ${String(wanted)} expected`,
        ),
      );
    }
  }

  // 3. Regression against the seed baseline.
  const regression = compareWithBaseline(analysis, baseline.value, ruleSet, session.id);
  const regressionTypes = new Set(regression.findings.map((finding) => finding.type));
  const missingTypes = want.regressionTypes.filter((type) => !regressionTypes.has(type));
  checks.push(
    check(
      'Regression against baseline',
      !regression.passed && missingTypes.length === 0,
      missingTypes.length === 0
        ? `${String(regression.findings.length)} regression finding(s), all expected kinds present`
        : `missing: ${missingTypes.join(', ')}`,
    ),
  );

  // 4. Reports.
  const built = buildReport({
    session,
    analysis,
    regression,
    generatedAt: 0,
    toolVersion: '0.1.0',
  });
  if (!built.ok) {
    return {
      checks: [...checks, check('Report is valid', false, built.issues.join('; '))],
      run: null,
    };
  }
  const report = built.value;
  const exports = {
    json: reportToJson(report),
    html: reportToHtml(report),
    findingsCsv: findingsToCsv(report),
    endpointsCsv: endpointsToCsv(report),
  };
  checks.push(check('Report is valid', true, 'JSON, HTML and CSV exports built'));

  // 5. Privacy: no planted secret survives anywhere; redaction leaves usable evidence.
  const outputs: Record<string, string> = {
    session: JSON.stringify(session),
    analysis: JSON.stringify(analysis),
    regression: JSON.stringify(regression),
    ...exports,
  };
  const leaks = Object.entries(outputs).flatMap(([name, text]) =>
    want.secrets.filter((secret) => text.includes(secret)).map((secret) => `${secret} in ${name}`),
  );
  checks.push(
    check(
      'No planted secret in any output',
      leaks.length === 0,
      leaks.length === 0
        ? `${String(want.secrets.length)} secrets checked in ${String(Object.keys(outputs).length)} outputs`
        : leaks.join(', '),
    ),
  );
  const urls = new Set([
    ...session.requests.map((request) => request.url),
    ...session.navigations.map((navigation) => navigation.url),
  ]);
  const absentSamples = want.redactedSamples.filter((sample) => !urls.has(sample));
  checks.push(
    check(
      'Redacted URLs keep their evidence',
      absentSamples.length === 0,
      absentSamples.length === 0
        ? want.redactedSamples.join(' | ')
        : `missing: ${absentSamples.join(', ')}`,
    ),
  );

  return { checks, run: { session, analysis, regression, report, exports } };
}
