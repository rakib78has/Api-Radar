import { LIMITS } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import {
  MAX_PENDING,
  RequestTracker,
  bodyFrom,
  type BeforeRequestEvent,
} from '../src/background/request-tracker.js';

const encoder = new TextEncoder();
const bytes = (text: string): ArrayBuffer => encoder.encode(text).slice().buffer;

function start(overrides: Partial<BeforeRequestEvent> = {}): BeforeRequestEvent {
  return {
    requestId: '41',
    url: 'https://shop.test/api/cart',
    method: 'GET',
    tabId: 7,
    frameId: 0,
    type: 'xmlhttprequest',
    timeStamp: 1_000.5,
    initiator: 'https://shop.test',
    documentId: 'DOC1',
    ...overrides,
  };
}

describe('bodyFrom', () => {
  it('treats a missing body as absent for GET and unavailable for POST', () => {
    expect(bodyFrom('GET', undefined)).toEqual({ kind: 'absent' });
    expect(bodyFrom('head', null)).toEqual({ kind: 'absent' });
    expect(bodyFrom('POST', undefined)).toEqual({ kind: 'unavailable' });
  });

  it('reports a body error as unavailable', () => {
    expect(bodyFrom('POST', { error: 'Unknown error' })).toEqual({ kind: 'unavailable' });
  });

  it('encodes form data as urlencoded text', () => {
    expect(
      bodyFrom('POST', {
        formData: { user: ['jane doe'], tags: ['a', 'b&c'], blob: [bytes('é')] },
      }),
    ).toEqual({
      kind: 'text',
      text: 'user=jane%20doe&tags=a&tags=b%26c&blob=%C3%A9',
      contentType: 'application/x-www-form-urlencoded',
    });
  });

  it('decodes raw bytes as UTF-8 across parts', () => {
    const euro = encoder.encode('{"p":"€"}');
    expect(
      bodyFrom('POST', {
        raw: [{ bytes: euro.slice(0, 7).buffer }, { bytes: euro.slice(7).buffer }],
      }),
    ).toEqual({ kind: 'text', text: '{"p":"€"}', contentType: null });
  });

  it('does not read file uploads or oversized bodies', () => {
    expect(bodyFrom('POST', { raw: [{ file: 'C:/secret.txt' }] })).toEqual({ kind: 'unavailable' });
    expect(bodyFrom('POST', { raw: [{}] })).toEqual({ kind: 'unavailable' });
    expect(
      bodyFrom('POST', { raw: [{ bytes: new ArrayBuffer(LIMITS.rawBodyLength + 1) }] }),
    ).toEqual({ kind: 'unavailable' });
  });

  it('treats an empty raw list as no body', () => {
    expect(bodyFrom('POST', { raw: [] })).toEqual({ kind: 'absent' });
  });
});

describe('RequestTracker', () => {
  it('joins start and completion into one observation', () => {
    const tracker = new RequestTracker();
    tracker.begin(start({ method: 'POST', requestBody: { raw: [{ bytes: bytes('{"a":1}') }] } }));
    const observation = tracker.complete({
      ...start(),
      method: 'POST',
      statusCode: 201,
      timeStamp: 1_040.5,
    });
    expect(observation).toEqual({
      id: 'wr-41-0',
      timestamp: 1_000.5,
      source: 'extension-webrequest',
      method: 'POST',
      url: 'https://shop.test/api/cart',
      resourceType: 'xmlhttprequest',
      status: 201,
      error: null,
      durationMs: 40,
      initiator: 'https://shop.test',
      context: { tabId: 7, frameId: 0, documentId: 'DOC1' },
      body: { kind: 'text', text: '{"a":1}', contentType: null },
    });
    expect(tracker.pendingCount).toBe(0);
  });

  it('records network errors', () => {
    const tracker = new RequestTracker();
    tracker.begin(start());
    expect(tracker.fail({ ...start(), error: 'net::ERR_FAILED', timeStamp: 1_010 })).toMatchObject({
      status: null,
      error: 'net::ERR_FAILED',
      durationMs: 9.5,
    });
  });

  it('gives every redirect hop its own observation and id', () => {
    const tracker = new RequestTracker();
    tracker.begin(start({ url: 'https://shop.test/old' }));
    const hop0 = tracker.redirect({
      ...start({ url: 'https://shop.test/old' }),
      statusCode: 302,
      timeStamp: 1_005,
    });
    tracker.begin(start({ url: 'https://shop.test/new', timeStamp: 1_006 }));
    const hop1 = tracker.complete({
      ...start({ url: 'https://shop.test/new' }),
      statusCode: 200,
      timeStamp: 1_020,
    });
    expect([hop0.id, hop0.status, hop0.url]).toEqual(['wr-41-0', 302, 'https://shop.test/old']);
    expect([hop1.id, hop1.status, hop1.url, hop1.durationMs]).toEqual([
      'wr-41-1',
      200,
      'https://shop.test/new',
      14,
    ]);
    // A later request reusing the id after completion starts again at hop 0.
    tracker.begin(start());
    expect(tracker.complete({ ...start(), statusCode: 200 }).id).toBe('wr-41-0');
  });

  it('still records a request whose start was lost (worker restart)', () => {
    const tracker = new RequestTracker();
    const observation = tracker.complete({
      ...start({ method: 'PUT' }),
      statusCode: 204,
      timeStamp: 2_000,
    });
    expect(observation).toMatchObject({
      timestamp: 2_000,
      durationMs: null,
      body: { kind: 'unavailable' },
    });
    expect(tracker.complete({ ...start(), statusCode: 200 }).body).toEqual({ kind: 'absent' });
  });

  it('maps background requests (tab -1) and odd values to null', () => {
    const tracker = new RequestTracker();
    const observation = tracker.complete({
      ...start({ tabId: -1, frameId: -1, initiator: undefined, documentId: undefined }),
      statusCode: 0,
    });
    expect(observation.context).toEqual({ tabId: null, frameId: null, documentId: null });
    expect(observation.initiator).toBeNull();
    expect(observation.status).toBe(0);
    expect(tracker.complete({ ...start(), statusCode: 1_000 }).status).toBeNull();
  });

  it('discards a negative duration from clock adjustments', () => {
    const tracker = new RequestTracker();
    tracker.begin(start({ timeStamp: 5_000 }));
    expect(
      tracker.complete({ ...start(), statusCode: 200, timeStamp: 4_000 }).durationMs,
    ).toBeNull();
  });

  it('forgets the oldest in-flight request when too many are pending', () => {
    const tracker = new RequestTracker();
    for (let i = 0; i <= MAX_PENDING; i++) {
      tracker.begin(start({ requestId: String(i), method: 'POST', requestBody: { raw: [] } }));
    }
    expect(tracker.pendingCount).toBe(MAX_PENDING);
    // Request 0 was evicted, so its body is unknown.
    expect(
      tracker.complete({ ...start({ requestId: '0', method: 'POST' }), statusCode: 200 }).body,
    ).toEqual({
      kind: 'unavailable',
    });
  });
});
