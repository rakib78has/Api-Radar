import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_RULE_SET,
  parseRuleSet,
  type CaptureSession,
  type DetectionRuleSet,
  type RegressionResult,
} from '@api-qa/contracts';
import { analyzeRequests, compareWithBaseline, type AnalysisResult } from '@api-qa/core';
import { test as base, type Page, type TestInfo } from '@playwright/test';

import { NetworkRecorder } from '../capture/recorder.js';
import { buildSession } from '../capture/session.js';
import { writeReports, type ReportFiles } from '../reporters/report-writer.js';
import { BaselineStore } from './baselines.js';
import { TEST_APP_ORIGIN } from './test-app.js';

const RUNNER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const RULES_DIR = `${RUNNER_ROOT}rules`;
export const BASELINES_DIR = `${RUNNER_ROOT}baselines`;

function readVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(`${RUNNER_ROOT}package.json`, 'utf8'));
  return typeof manifest === 'object' && manifest !== null && 'version' in manifest
    ? String(manifest.version)
    : '0.0.0';
}
const TOOL_VERSION = readVersion();

/** Loads `rules/<name>.json`, or the default rules for "default". Invalid files fail loudly. */
export function loadRules(name: string): DetectionRuleSet {
  if (name === 'default') {
    return DEFAULT_RULE_SET;
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`Invalid rule set name "${name}"`);
  }
  const parsed = parseRuleSet(readFileSync(`${RULES_DIR}/${name}.json`, 'utf8'));
  if (!parsed.ok) {
    throw new Error(
      `rules/${name}.json is invalid:\n${parsed.issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
  }
  return parsed.value;
}

export interface RunResult {
  readonly session: CaptureSession;
  readonly analysis: AnalysisResult;
}

export interface StopOptions {
  /** How long to wait for in-flight requests before recording them as unfinished. */
  readonly settleMs?: number;
}

export interface ApiQa {
  readonly ruleSet: DetectionRuleSet;
  readonly baselines: BaselineStore;
  /** Starts recording the test's page. */
  start(): Promise<void>;
  /** Stops recording, then normalises, redacts and analyses the traffic. */
  stop(options?: StopOptions): Promise<RunResult>;
  /** Navigates to a test-app scenario page and waits until its script has finished. */
  runScenario(path: string): Promise<void>;
  /**
   * Compares with `baselines/<name>.json`. With UPDATE_BASELINES=1 the
   * baseline is (re)recorded from this run instead.
   */
  compare(result: RunResult, baselineName: string): RegressionResult;
  /** Writes JSON, HTML and CSV reports and attaches them to the test result. */
  report(result: RunResult, regression?: RegressionResult | null): Promise<ReportFiles>;
}

function sessionIdFor(testInfo: TestInfo): string {
  const slug = testInfo.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `run-${slug.slice(0, 80)}-${String(testInfo.repeatEachIndex)}-${String(testInfo.retry)}`;
}

function createApiQa(page: Page, ruleSet: DetectionRuleSet, testInfo: TestInfo) {
  const baselines = new BaselineStore(BASELINES_DIR);
  let recorder: NetworkRecorder | null = null;
  let startedAt = 0;

  const apiQa: ApiQa = {
    ruleSet,
    baselines,

    async start() {
      if (recorder !== null) {
        throw new Error('apiQa.start() was already called in this test.');
      }
      recorder = await NetworkRecorder.attach(page);
      recorder.start();
      startedAt = Date.now();
    },

    async stop(options = {}) {
      if (recorder === null) {
        throw new Error('apiQa.stop() called before apiQa.start().');
      }
      const events = await recorder.stop(options.settleMs);
      const session = buildSession(events, ruleSet, {
        id: sessionIdFor(testInfo),
        name: testInfo.titlePath.slice(1).join(' › ').slice(0, 200) || 'Playwright run',
        startedAt,
        endedAt: Date.now(),
      });
      return { session, analysis: analyzeRequests(session, ruleSet) };
    },

    async runScenario(path) {
      await page.goto(`${TEST_APP_ORIGIN}${path}`);
      await page.locator('body[data-state="done"], body[data-state="error"]').waitFor();
      const error = await page.locator('body').getAttribute('data-error');
      if (error !== null) {
        throw new Error(`Scenario ${path} failed in the page: ${error}`);
      }
    },

    compare(result, baselineName) {
      const baseline =
        process.env.UPDATE_BASELINES === '1'
          ? baselines.save(baselineName, result.analysis, Date.now())
          : baselines.load(baselineName);
      if (process.env.UPDATE_BASELINES === '1') {
        testInfo.annotations.push({ type: 'baseline', description: `recorded ${baselineName}` });
      }
      return compareWithBaseline(result.analysis, baseline, ruleSet, result.session.id);
    },

    async report(result, regression = null) {
      const files = writeReports({
        session: result.session,
        analysis: result.analysis,
        regression,
        directory: testInfo.outputPath('api-qa'),
        toolVersion: TOOL_VERSION,
        generatedAt: Date.now(),
      });
      await testInfo.attach('api-qa-report.html', { path: files.html, contentType: 'text/html' });
      await testInfo.attach('api-qa-report.json', {
        path: files.json,
        contentType: 'application/json',
      });
      return files;
    },
  };

  const teardown = async () => {
    if (recorder?.capturing === true) {
      await recorder.stop(0);
    }
  };
  return { apiQa, teardown };
}

interface Options {
  /** Rule set from `rules/<name>.json`, or "default". Set with `test.use({ rules: 'polling' })`. */
  readonly rules: string;
}

interface Fixtures {
  readonly ruleSet: DetectionRuleSet;
  readonly apiQa: ApiQa;
}

export const test = base.extend<Options & Fixtures>({
  rules: ['default', { option: true }],
  ruleSet: async ({ rules }, use) => {
    await use(loadRules(rules));
  },
  apiQa: async ({ page, ruleSet }, use, testInfo) => {
    const { apiQa, teardown } = createApiQa(page, ruleSet, testInfo);
    await use(apiQa);
    await teardown();
  },
});

export { expect } from '@playwright/test';
export { TEST_APP_ORIGIN };
