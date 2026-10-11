import type { CapturedRequest, NavigationEvent } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { analyzeRequests } from '../src/index.js';
import { ORIGIN, navigation, request, ruleSet } from './fixtures.js';

const NAVIGATIONS: NavigationEvent[] = [
  navigation('n1', 0, 'doc-1'),
  navigation('n2', 5_000, 'doc-2'),
];

const analyse = (
  requests: CapturedRequest[],
  navigations: NavigationEvent[] = NAVIGATIONS,
  rules = ruleSet(),
) => analyzeRequests({ requests, navigations }, rules).findings;

const fromDoc1At = (id: string, timestamp: number) =>
  request({ id, timestamp, url: `${ORIGIN}/api/feed`, context: { documentId: 'doc-1' } });

describe('requests after navigation', () => {
  it('reports requests from a document after it was replaced', () => {
    const findings = analyse([fromDoc1At('late1', 6_000), fromDoc1At('late2', 9_000)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'request-after-navigation',
      severity: 'medium',
      confidence: 'high',
      endpoint: `GET ${ORIGIN}/api/feed`,
      evidence: { requestIds: ['late1', 'late2'], requestCount: 2 },
    });
    expect(findings[0]?.evidence.measurements).toMatchObject({
      navigatedAt: 5_000,
      firstDelayAfterNavigationMs: 1_000,
      navigatedTo: `${ORIGIN}/page-n2`,
    });
  });

  it('ignores requests before the navigation or within the grace period', () => {
    expect(analyse([fromDoc1At('early', 4_000), fromDoc1At('grace', 5_100)])).toEqual([]);
  });

  it('ignores requests from the current document', () => {
    expect(
      analyse([request({ id: 'cur', timestamp: 6_000, context: { documentId: 'doc-2' } })]),
    ).toEqual([]);
  });

  it('skips requests that cannot be attributed', () => {
    const unknownDoc = request({ id: 'x', timestamp: 6_000, context: { documentId: null } });
    const unknownTab = request({ id: 'y', timestamp: 6_000, context: { tabId: null } });
    const unseenDoc = request({ id: 'z', timestamp: 6_000, context: { documentId: 'doc-9' } });
    expect(analyse([unknownDoc, unknownTab, unseenDoc])).toEqual([]);
  });

  it('ignores navigations in other tabs and in iframes', () => {
    const navigations = [
      navigation('n1', 0, 'doc-1'),
      navigation('other-tab', 5_000, 'doc-2', { tabId: 2 }),
      navigation('iframe', 5_000, 'doc-3', { frameId: 7 }),
    ];
    expect(analyse([fromDoc1At('r', 6_000)], navigations)).toEqual([]);
  });

  it('ignores navigation events without a document id', () => {
    const navigations = [navigation('n1', 0, 'doc-1'), navigation('n2', 5_000, null)];
    expect(analyse([fromDoc1At('r', 6_000)], navigations)).toEqual([]);
  });

  it('handles back-navigation to an earlier document (bfcache)', () => {
    const navigations = [
      navigation('n1', 0, 'doc-1'),
      navigation('n2', 1_000, 'doc-2'),
      navigation('n3', 2_000, 'doc-1'),
    ];
    // doc-1 is current again at 3000, so its request is legitimate.
    expect(analyse([fromDoc1At('r', 3_000)], navigations)).toEqual([]);
    // doc-2 was replaced at 2000.
    const late = request({ id: 'd2', timestamp: 3_000, context: { documentId: 'doc-2' } });
    expect(analyse([late], navigations)).toHaveLength(1);
  });

  it('can be disabled', () => {
    const rules = ruleSet({ navigation: { enabled: false } });
    expect(analyse([fromDoc1At('late', 6_000)], NAVIGATIONS, rules)).toEqual([]);
  });

  it('does not depend on the order of navigation events', () => {
    const late = [fromDoc1At('late', 6_000)];
    expect(analyse(late, [...NAVIGATIONS].reverse())).toEqual(analyse(late));
  });
});
