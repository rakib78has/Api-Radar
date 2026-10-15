import {
  DEFAULT_RULE_SET,
  parseRuleSet,
  parseWith,
  type DetectionRuleSet,
  type ParseResult,
} from '@api-qa/contracts';

import type { KeyValueStore } from './key-value-store.js';
import { DEFAULT_RETENTION, retentionPolicySchema, type RetentionPolicy } from './schemas.js';

const RULE_SET_KEY = 'settings:ruleSet';
const RETENTION_KEY = 'settings:retention';

export interface StoredRuleSet {
  readonly ruleSet: DetectionRuleSet;
  /** Problems with the stored rule set; when present, `ruleSet` is the default. */
  readonly issues: readonly string[];
}

/** The tester's detection rules and retention policy, validated on every read and write. */
export class SettingsRepository {
  readonly #store: KeyValueStore;

  constructor(store: KeyValueStore) {
    this.#store = store;
  }

  async getRuleSet(): Promise<StoredRuleSet> {
    const raw = (await this.#store.get([RULE_SET_KEY]))[RULE_SET_KEY];
    if (raw === undefined) {
      return { ruleSet: DEFAULT_RULE_SET, issues: [] };
    }
    const parsed = parseRuleSet(raw);
    return parsed.ok
      ? { ruleSet: parsed.value, issues: [] }
      : { ruleSet: DEFAULT_RULE_SET, issues: parsed.issues };
  }

  /** Validates `input` (JSON text or a value) and stores it only if valid. */
  async saveRuleSet(input: unknown): Promise<ParseResult<DetectionRuleSet>> {
    const parsed = parseRuleSet(input);
    if (parsed.ok) {
      await this.#store.set({ [RULE_SET_KEY]: parsed.value });
    }
    return parsed;
  }

  async resetRuleSet(): Promise<void> {
    await this.#store.remove([RULE_SET_KEY]);
  }

  async getRetention(): Promise<RetentionPolicy> {
    const raw = (await this.#store.get([RETENTION_KEY]))[RETENTION_KEY];
    const parsed = parseWith(retentionPolicySchema, raw ?? {});
    return parsed.ok ? parsed.value : DEFAULT_RETENTION;
  }

  async saveRetention(input: unknown): Promise<ParseResult<RetentionPolicy>> {
    const parsed = parseWith(retentionPolicySchema, input);
    if (parsed.ok) {
      await this.#store.set({ [RETENTION_KEY]: parsed.value });
    }
    return parsed;
  }
}
