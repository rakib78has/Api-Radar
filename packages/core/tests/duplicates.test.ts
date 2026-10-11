import type { Finding, FindingType } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { analyzeRequests, detectDuplicates } from '../src/index.js';
import { ORIGIN, request, requestsAt, ruleSet } from './fixtures.js';

function duplicatesIn(findings: readonly Finding[], type: FindingType = 'duplicate-request') {
  return findings.filter((finding) => finding.type === type);
}

const analyse = (requests: Parameters<typeof analyzeRequests>[0]['requests'], rules = ruleSet()) =>
  analyzeRequests({ requests, navigations: [] }, rules).findings;

describe('duplicate detection (rule A)', () => {
  it('reports nothing for a single request', () => {
    expect(analyse([request()])).toEqual([]);
  });

  it('reports two identical GETs within the window as one low-severity finding', () => {
    const findings = duplicatesIn(analyse(requestsAt([1_000, 1_200])));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'low',
      confidence: 'high',
      endpoint: `GET ${ORIGIN}/api/items`,
      evidence: { requestIds: ['r1', 'r2'], requestCount: 2, firstTimestamp: 1_000 },
    });
    expect(findings[0]?.evidence.measurements).toMatchObject({ copies: 2, spanMs: 200 });
  });

  it('treats the window as inclusive and ignores repeats beyond it', () => {
    expect(duplicatesIn(analyse(requestsAt([1_000, 2_000])))).toHaveLength(1);
    expect(duplicatesIn(analyse(requestsAt([1_000, 2_001])))).toEqual([]);
  });

  it('chains requests by gap, so a steady 800 ms repeat forms one group', () => {
    const findings = duplicatesIn(analyse(requestsAt([0, 800, 1_600, 2_400])));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence.requestCount).toBe(4);
  });

  it('splits separate bursts into separate findings', () => {
    expect(duplicatesIn(analyse(requestsAt([0, 100, 10_000, 10_100])))).toHaveLength(2);
  });

  it('does not treat different query parameters as duplicates', () => {
    const requests = [
      request({ id: 'a', url: `${ORIGIN}/api/items?page=1` }),
      request({ id: 'b', url: `${ORIGIN}/api/items?page=2`, timestamp: 1_001 }),
    ];
    expect(analyse(requests)).toEqual([]);
  });

  it('does not treat different resource ids as duplicates', () => {
    const requests = [
      request({ id: 'a', url: `${ORIGIN}/api/users/1` }),
      request({ id: 'b', url: `${ORIGIN}/api/users/2` }),
    ];
    expect(analyse(requests)).toEqual([]);
  });

  it('allows legitimate concurrent requests to different endpoints', () => {
    const requests = ['users', 'orders', 'settings'].map((name, index) =>
      request({ id: name, url: `${ORIGIN}/api/${name}`, timestamp: 1_000 + index }),
    );
    expect(analyse(requests)).toEqual([]);
  });

  it('does not compare requests from different tabs or documents', () => {
    const requests = [
      request({ id: 'a' }),
      request({ id: 'b', context: { tabId: 2 } }),
      request({ id: 'c', context: { documentId: 'doc-2' } }),
    ];
    expect(analyse(requests)).toEqual([]);
  });

  it('rates duplicated POSTs high because each copy can change data', () => {
    const body = { kind: 'text' as const, text: '{"sku":1}', contentType: 'application/json' };
    const findings = duplicatesIn(analyse(requestsAt([0, 50], { method: 'POST', body })));
    expect(findings[0]).toMatchObject({ severity: 'high', confidence: 'high' });
  });

  it('does not treat POSTs with different bodies as duplicates', () => {
    const post = (id: string, text: string) =>
      request({
        id,
        method: 'POST',
        body: { kind: 'text', text, contentType: 'application/json' },
      });
    expect(analyse([post('a', '{"sku":1}'), post('b', '{"sku":2}')])).toEqual([]);
  });

  it('rates PUT and DELETE duplicates medium', () => {
    expect(duplicatesIn(analyse(requestsAt([0, 50], { method: 'DELETE' })))[0]?.severity).toBe(
      'medium',
    );
  });

  it('raises repeated reads to medium once they pile up', () => {
    expect(duplicatesIn(analyse(requestsAt([0, 10, 20, 30, 40])))[0]?.severity).toBe('medium');
  });

  it('lowers confidence when the bodies could not be compared', () => {
    const findings = duplicatesIn(
      analyse(requestsAt([0, 50], { method: 'POST', body: { kind: 'unavailable' } })),
    );
    expect(findings[0]).toMatchObject({ confidence: 'low' });
    expect(findings[0]?.reasoning).toContain('bodies could not be compared');
  });

  it('lowers confidence when the document is unknown', () => {
    const findings = duplicatesIn(analyse(requestsAt([0, 50], { context: { documentId: null } })));
    expect(findings[0]).toMatchObject({ confidence: 'medium' });
  });

  it('honours a custom window and can be disabled', () => {
    const requests = requestsAt([0, 3_000]);
    expect(analyse(requests, ruleSet({ duplicates: { windowMs: 5_000 } }))).toHaveLength(1);
    expect(analyse(requests, ruleSet({ duplicates: { enabled: false, windowMs: 5_000 } }))).toEqual(
      [],
    );
    expect(detectDuplicates(requests, { enabled: false, windowMs: 5_000 })).toEqual([]);
  });

  it('caps evidence ids but keeps the true count', () => {
    const timestamps = Array.from({ length: 150 }, (_, i) => i);
    const finding = duplicatesIn(analyse(requestsAt(timestamps)))[0];
    expect(finding?.evidence.requestIds).toHaveLength(100);
    expect(finding?.evidence.requestCount).toBe(150);
  });

  it('gives the same finding id when the session is re-analysed', () => {
    const requests = requestsAt([0, 50]);
    expect(analyse(requests)[0]?.id).toBe(analyse([...requests].reverse())[0]?.id);
  });
});
