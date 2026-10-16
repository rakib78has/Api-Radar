import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { runSeed, type SeedFiles } from '../../scripts/lib/seed.ts';

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../../examples/seed/${name}`, import.meta.url), 'utf8'));

const files: SeedFiles = {
  observations: readJson('observations.json'),
  rules: readJson('rules.json'),
  baseline: readJson('baseline.json'),
  expected: readJson('expected.json'),
};

describe('seed data (examples/seed)', () => {
  const result = runSeed(files);

  it.each(result.checks.map((item) => [item.name, item] as const))('%s', (_name, item) => {
    expect(item.ok, item.detail).toBe(true);
  });

  it('runs every stage', () => {
    expect(result.run).not.toBeNull();
    expect(result.checks.length).toBeGreaterThanOrEqual(13);
  });

  it('fails clearly when an expectation is wrong', () => {
    const expected = { ...(files.expected as Record<string, unknown>), storedRequests: 999 };
    const broken = runSeed({ ...files, expected });
    expect(broken.checks.find((item) => item.name === 'Requests stored and dropped')?.ok).toBe(
      false,
    );
  });

  it('reports invalid seed files instead of throwing', () => {
    const broken = runSeed({ ...files, rules: { schemaVersion: 2 } });
    expect(broken.run).toBeNull();
    expect(broken.checks[0]?.detail).toMatch(/^rules\.json /);
  });
});
