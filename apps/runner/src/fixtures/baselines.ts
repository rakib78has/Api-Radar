import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parseBaseline, type Baseline } from '@api-qa/contracts';
import { createBaseline, type AnalysisResult } from '@api-qa/core';

export class BaselineError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[]) {
    super([message, ...issues.map((issue) => `  - ${issue}`)].join('\n'));
    this.name = 'BaselineError';
    this.issues = issues;
  }
}

/** Baseline names become file names, so only safe characters are allowed. */
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class BaselineStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = directory;
  }

  pathOf(name: string): string {
    if (!NAME.test(name)) {
      throw new BaselineError(`Invalid baseline name "${name}"`, [
        'Use lower-case letters, digits and hyphens.',
      ]);
    }
    return join(this.#directory, `${name}.json`);
  }

  exists(name: string): boolean {
    return existsSync(this.pathOf(name));
  }

  /** Reads and validates a baseline file; any problem throws BaselineError. */
  load(name: string): Baseline {
    const path = this.pathOf(name);
    if (!existsSync(path)) {
      throw new BaselineError(`Baseline "${name}" does not exist at ${path}`, [
        'Record it with: pnpm baselines:update',
      ]);
    }
    const parsed = parseBaseline(readFileSync(path, 'utf8'));
    if (!parsed.ok) {
      throw new BaselineError(`Baseline "${name}" is invalid`, parsed.issues);
    }
    return parsed.value;
  }

  /** Records an analysis as the named baseline. */
  save(name: string, analysis: AnalysisResult, createdAt: number): Baseline {
    const path = this.pathOf(name);
    const baseline = createBaseline(analysis, { name, createdAt });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
    return baseline;
  }
}
