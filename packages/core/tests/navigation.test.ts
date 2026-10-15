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

describe('route changes in single-page apps (navigation.routeChanges)', () => {
  // One document (doc-1) that changes route at 5000 via the history API.
  const ROUTES: NavigationEvent[] = [
    navigation('load', 0, 'doc-1'),
    navigation('to-settings', 5_000, 'doc-1'),
  ];
  const ON = ruleSet({ navigation: { routeChanges: true }, duplicates: { enabled: false } });

  const poll = (id: string, timestamp: number, path = '/api/status') =>
    request({ id, timestamp, url: `${ORIGIN}${path}`, context: { documentId: 'doc-1' } });

  it('reports an endpoint that kept repeating after the route changed', () => {
    const requests = [poll('a', 1_000), poll('b', 3_000), poll('c', 6_000), poll('d', 8_000)];
    const findings = analyse(requests, ROUTES, ON);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      type: 'request-after-navigation',
      confidence: 'medium',
      title: 'GET calls continued after a route change',
      evidence: { requestIds: ['c', 'd'], requestCount: 2 },
    });
    expect(findings[0]?.evidence.measurements).toMatchObject({
      callsBefore: 2,
      callsAfter: 2,
      routeChangedAt: 5_000,
    });
  });

  it('is off by default', () => {
    const requests = [poll('a', 1_000), poll('b', 3_000), poll('c', 6_000)];
    expect(analyse(requests, ROUTES, ruleSet({ duplicates: { enabled: false } }))).toEqual([]);
  });

  it('ignores a single call before the change, calls only after it, and the grace period', () => {
    expect(analyse([poll('a', 1_000), poll('c', 6_000)], ROUTES, ON)).toEqual([]);
    expect(analyse([poll('c', 6_000), poll('d', 7_000)], ROUTES, ON)).toEqual([]);
    expect(analyse([poll('a', 1_000), poll('b', 3_000), poll('c', 5_050)], ROUTES, ON)).toEqual([]);
  });

  it('stops at the next navigation', () => {
    const routes = [...ROUTES, navigation('to-home', 7_000, 'doc-1')];
    const requests = [poll('a', 1_000), poll('b', 3_000), poll('c', 7_500)];
    // c belongs to the third route, whose previous route made no calls.
    expect(analyse(requests, routes, ON)).toEqual([]);
  });

  it('treats a new document as a replacement, not a route change', () => {
    const replaced = [navigation('load', 0, 'doc-1'), navigation('next', 5_000, 'doc-2')];
    const findings = analyse([poll('a', 1_000), poll('b', 3_000), poll('c', 6_000)], replaced, ON);
    expect(findings.map((finding) => finding.confidence)).toEqual(['high']);
  });

  it('exempts endpoints with a polling policy', () => {
    const rules = ruleSet({
      navigation: { routeChanges: true },
      polling: [{ id: 'status', match: { path: '/api/status' }, expectedIntervalMs: 1_000 }],
    });
    const requests = [poll('a', 1_000), poll('b', 3_000), poll('c', 6_000), poll('d', 8_000)];
    expect(analyse(requests, ROUTES, rules)).toEqual([]);
  });

  it('only compares requests from the same document', () => {
    const other = (id: string, timestamp: number) =>
      request({ id, timestamp, url: `${ORIGIN}/api/status`, context: { documentId: 'doc-x' } });
    expect(analyse([other('a', 1_000), other('b', 3_000), other('c', 6_000)], ROUTES, ON)).toEqual(
      [],
    );
  });
});
