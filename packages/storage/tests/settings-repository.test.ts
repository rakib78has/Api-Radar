import { DEFAULT_RULE_SET } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { DEFAULT_RETENTION, MemoryStore, SettingsRepository } from '../src/index.js';

describe('SettingsRepository', () => {
  it('returns the default rule set when nothing is stored', async () => {
    const settings = new SettingsRepository(new MemoryStore());
    expect(await settings.getRuleSet()).toEqual({ ruleSet: DEFAULT_RULE_SET, issues: [] });
  });

  it('stores a valid rule set with defaults applied', async () => {
    const settings = new SettingsRepository(new MemoryStore());
    const saved = await settings.saveRuleSet('{"schemaVersion":1,"name":"Checkout"}');
    expect(saved.ok).toBe(true);
    const stored = await settings.getRuleSet();
    expect(stored.issues).toEqual([]);
    expect(stored.ruleSet.name).toBe('Checkout');
    expect(stored.ruleSet.duplicates.windowMs).toBe(1_000);
  });

  it('refuses an invalid rule set and keeps the previous one', async () => {
    const settings = new SettingsRepository(new MemoryStore());
    await settings.saveRuleSet({ schemaVersion: 1, name: 'Good' });
    const result = await settings.saveRuleSet({ schemaVersion: 1, name: 'Bad', typo: true });
    expect(result.ok).toBe(false);
    expect((await settings.getRuleSet()).ruleSet.name).toBe('Good');
  });

  it('falls back to the default and reports issues when stored rules are corrupt', async () => {
    const store = new MemoryStore();
    await store.set({ 'settings:ruleSet': { schemaVersion: 7 } });
    const stored = await new SettingsRepository(store).getRuleSet();
    expect(stored.ruleSet).toBe(DEFAULT_RULE_SET);
    expect(stored.issues.length).toBeGreaterThan(0);
  });

  it('resets the rule set', async () => {
    const settings = new SettingsRepository(new MemoryStore());
    await settings.saveRuleSet({ schemaVersion: 1, name: 'Custom' });
    await settings.resetRuleSet();
    expect((await settings.getRuleSet()).ruleSet).toBe(DEFAULT_RULE_SET);
  });

  it('validates the retention policy', async () => {
    const store = new MemoryStore();
    const settings = new SettingsRepository(store);
    expect(await settings.getRetention()).toEqual(DEFAULT_RETENTION);
    expect((await settings.saveRetention({ maxSessions: 0 })).ok).toBe(false);
    expect((await settings.saveRetention({ maxSessions: 5 })).ok).toBe(true);
    expect(await settings.getRetention()).toEqual({ maxSessions: 5, maxAgeDays: 30 });
    await store.set({ 'settings:retention': { maxSessions: 'many' } });
    expect(await settings.getRetention()).toEqual(DEFAULT_RETENTION);
  });
});
