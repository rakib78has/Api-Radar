// Runs the seed capture through the whole engine and checks the outcome.
// Usage: pnpm seed:check   (builds the packages first)
// Reports are written to reports/seed/ so you can open them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { runSeed } from './lib/seed.ts';

const SEED = 'examples/seed';
const OUT = 'reports/seed';

const readJson = (name: string): unknown => JSON.parse(readFileSync(`${SEED}/${name}`, 'utf8'));

const result = runSeed({
  observations: readJson('observations.json'),
  rules: readJson('rules.json'),
  baseline: readJson('baseline.json'),
  expected: readJson('expected.json'),
});

const width = Math.max(...result.checks.map((item) => item.name.length));
for (const item of result.checks) {
  process.stdout.write(
    `${item.ok ? 'PASS' : 'FAIL'}  ${item.name.padEnd(width)}  ${item.detail}\n`,
  );
}

if (result.run !== null) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/session.json`, `${JSON.stringify(result.run.session, null, 2)}\n`);
  writeFileSync(`${OUT}/api-qa-report.json`, result.run.exports.json);
  writeFileSync(`${OUT}/api-qa-report.html`, result.run.exports.html);
  writeFileSync(`${OUT}/api-qa-findings.csv`, result.run.exports.findingsCsv);
  writeFileSync(`${OUT}/api-qa-endpoints.csv`, result.run.exports.endpointsCsv);
  process.stdout.write(`\nReports written to ${OUT}/ (open api-qa-report.html in a browser).\n`);
}

const failed = result.checks.filter((item) => !item.ok).length;
process.stdout.write(
  failed === 0
    ? `\nAll ${String(result.checks.length)} checks passed: the project works end to end.\n`
    : `\n${String(failed)} of ${String(result.checks.length)} checks failed.\n`,
);
process.exit(failed === 0 ? 0 : 1);
