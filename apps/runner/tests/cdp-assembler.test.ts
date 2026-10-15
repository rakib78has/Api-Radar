import { describe, expect, it } from 'vitest';

import { CdpAssembler, bodyOf, type CdpRequestWillBeSent } from '../src/capture/cdp-assembler.js';

const ORIGIN = 'http://127.0.0.1:47130';

function willBeSent(overrides: Partial<CdpRequestWillBeSent> = {}): CdpRequestWillBeSent {
  return {
    requestId: '1000.1',
    loaderId: 'LOADER-A',
    documentURL: `${ORIGIN}/s/single?x=1`,
    frameId: 'MAIN',
    type: 'Fetch',
    timestamp: 100,
    wallTime: 1_700_000_000,
    request: { url: `${ORIGIN}/api/items`, method: 'GET', headers: {} },
    ...overrides,
  };
}

function capturing(now = () => 5_000): CdpAssembler {
  const assembler = new CdpAssembler(3, now);
  assembler.start();
  assembler.onFrameNavigated({
    frame: { id: 'MAIN', loaderId: 'LOADER-A', url: `${ORIGIN}/s/single` },
  });
  return assembler;
}

describe('bodyOf', () => {
  it('keeps inline post data with its content type only', () => {
    expect(
      bodyOf({
        url: ORIGIN,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secret' },
        postData: '{"a":1}',
      }),
    ).toEqual({ kind: 'text', text: '{"a":1}', contentType: 'application/json' });
    expect(bodyOf({ url: ORIGIN, method: 'POST', headers: {}, postData: 'x' })).toEqual({
      kind: 'text',
      text: 'x',
      contentType: null,
    });
  });

  it('marks bodies too large to inline as unavailable, and missing ones as absent', () => {
    expect(bodyOf({ url: ORIGIN, method: 'POST', headers: {}, hasPostData: true })).toEqual({
      kind: 'unavailable',
    });
    expect(bodyOf({ url: ORIGIN, method: 'POST', headers: {} })).toEqual({ kind: 'absent' });
    expect(bodyOf({ url: ORIGIN, method: 'GET', headers: {} })).toEqual({ kind: 'absent' });
  });
});

describe('CdpAssembler', () => {
  it('joins request, response and completion into one observation', () => {
    const assembler = capturing();
    assembler.onRequestWillBeSent(willBeSent());
    assembler.onResponseReceived({ requestId: '1000.1', response: { status: 201 } });
    expect(assembler.pendingCount).toBe(1);
    assembler.onLoadingFinished({ requestId: '1000.1', timestamp: 100.0425 });
    const { requests, navigations } = assembler.stop();

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.durationMs).toBeCloseTo(42.5, 6);
    expect({ ...request, durationMs: 0 }).toEqual({
      id: 'cdp-1000.1-0',
      timestamp: 1_700_000_000_000,
      source: 'playwright',
      method: 'GET',
      url: `${ORIGIN}/api/items`,
      resourceType: 'Fetch',
      status: 201,
      error: null,
      durationMs: 0,
      initiator: ORIGIN,
      context: { tabId: 3, frameId: 0, documentId: 'LOADER-A' },
      body: { kind: 'absent' },
    });
    expect(navigations).toEqual([
      {
        id: 'nav-3-1',
        timestamp: 5_000,
        url: `${ORIGIN}/s/single`,
        context: { tabId: 3, frameId: 0, documentId: 'LOADER-A' },
      },
    ]);
  });

  it('records failures with their error text', () => {
    const assembler = capturing();
    assembler.onRequestWillBeSent(willBeSent());
    assembler.onLoadingFailed({
      requestId: '1000.1',
      timestamp: 101,
      errorText: 'net::ERR_CONNECTION_REFUSED',
    });
    assembler.onRequestWillBeSent(willBeSent({ requestId: '2' }));
    assembler.onLoadingFailed({ requestId: '2', timestamp: 101, errorText: '' });
    const { requests } = assembler.stop();
    expect(requests.map((request) => [request.status, request.error])).toEqual([
      [null, 'net::ERR_CONNECTION_REFUSED'],
      [null, 'net::ERR_FAILED'],
    ]);
  });

  it('splits redirects into hops with their own ids and statuses', () => {
    const assembler = capturing();
    assembler.onRequestWillBeSent(
      willBeSent({ request: { url: `${ORIGIN}/old`, method: 'GET', headers: {} } }),
    );
    assembler.onRequestWillBeSent(
      willBeSent({
        timestamp: 100.01,
        request: { url: `${ORIGIN}/new`, method: 'GET', headers: {} },
        redirectResponse: { status: 302 },
      }),
    );
    assembler.onResponseReceived({ requestId: '1000.1', response: { status: 200 } });
    assembler.onLoadingFinished({ requestId: '1000.1', timestamp: 100.02 });
    const { requests } = assembler.stop();
    expect(requests.map((request) => [request.id, request.url, request.status])).toEqual([
      ['cdp-1000.1-0', `${ORIGIN}/old`, 302],
      ['cdp-1000.1-1', `${ORIGIN}/new`, 200],
    ]);
  });

  it('records requests still in flight at stop with an unknown outcome', () => {
    const assembler = capturing();
    assembler.onRequestWillBeSent(willBeSent());
    assembler.onResponseReceived({ requestId: 'unknown', response: { status: 200 } });
    assembler.onLoadingFinished({ requestId: 'unknown', timestamp: 1 });
    assembler.onLoadingFailed({ requestId: 'unknown', timestamp: 1, errorText: 'x' });
    const { requests } = assembler.stop();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ status: null, error: null, durationMs: null });
  });

  it('ignores non-http requests and events outside start..stop', () => {
    const assembler = new CdpAssembler(1, () => 0);
    assembler.onRequestWillBeSent(willBeSent({ requestId: 'early' }));
    assembler.onFrameNavigated({ frame: { id: 'MAIN', loaderId: 'L0', url: `${ORIGIN}/` } });
    assembler.start();
    assembler.onRequestWillBeSent(
      willBeSent({
        requestId: 'data',
        request: { url: 'data:text/plain,hi', method: 'GET', headers: {} },
      }),
    );
    assembler.onLoadingFinished({ requestId: 'early', timestamp: 1 });
    assembler.onLoadingFinished({ requestId: 'data', timestamp: 1 });
    expect(assembler.stop()).toEqual({ requests: [], navigations: [] });
  });

  it('maps frames: main frame 0, iframes numbered, unknown frames null', () => {
    const assembler = capturing();
    assembler.onFrameNavigated({
      frame: { id: 'CHILD', parentId: 'MAIN', loaderId: 'LOADER-C', url: `${ORIGIN}/frame` },
    });
    assembler.onFrameNavigated({
      frame: { id: 'CHILD', parentId: 'MAIN', loaderId: 'LOADER-D', url: `${ORIGIN}/frame2` },
    });
    for (const [requestId, frameId] of [
      ['a', 'CHILD'],
      ['b', 'OTHER'],
      ['c', undefined],
    ] as const) {
      assembler.onRequestWillBeSent(willBeSent({ requestId, frameId, loaderId: '' }));
      assembler.onLoadingFinished({ requestId, timestamp: 101 });
    }
    const { requests, navigations } = assembler.stop();
    expect(requests.map((request) => request.context.frameId)).toEqual([1, null, null]);
    expect(requests.map((request) => request.context.documentId)).toEqual([null, null, null]);
    // Only the main frame's navigation is recorded.
    expect(navigations).toHaveLength(1);
  });

  it('records history-API route changes with the same document id', () => {
    let clock = 1_000;
    const assembler = capturing(() => clock++);
    assembler.onNavigatedWithinDocument({ frameId: 'MAIN', url: `${ORIGIN}/s/spa-settings` });
    assembler.onNavigatedWithinDocument({ frameId: 'CHILD', url: `${ORIGIN}/ignored` });
    const { navigations } = assembler.stop();
    expect(
      navigations.map((navigation) => [navigation.url, navigation.context.documentId]),
    ).toEqual([
      [`${ORIGIN}/s/single`, 'LOADER-A'],
      [`${ORIGIN}/s/spa-settings`, 'LOADER-A'],
    ]);
  });

  it('ignores a route change before the main frame is known', () => {
    const assembler = new CdpAssembler(1, () => 0);
    assembler.start();
    assembler.onNavigatedWithinDocument({ frameId: 'MAIN', url: ORIGIN });
    expect(assembler.stop().navigations).toEqual([]);
  });

  it('enforces the lifecycle', () => {
    const assembler = new CdpAssembler(1, () => 0);
    expect(() => assembler.stop()).toThrow('has not been started');
    assembler.start();
    expect(assembler.capturing).toBe(true);
    expect(() => {
      assembler.start();
    }).toThrow('already running');
    assembler.stop();
    expect(() => {
      assembler.start();
    }).toThrow('already been stopped');
  });

  it('sanitises request ids, clamps odd values and rejects negative durations', () => {
    const assembler = capturing();
    assembler.onRequestWillBeSent(
      willBeSent({
        requestId: 'interception job/1',
        documentURL: 'about:blank',
        type: undefined,
        timestamp: 200,
      }),
    );
    assembler.onResponseReceived({ requestId: 'interception job/1', response: { status: 1_234 } });
    assembler.onLoadingFinished({ requestId: 'interception job/1', timestamp: 199 });
    const [request] = assembler.stop().requests;
    expect(request).toMatchObject({
      id: 'cdp-interception_job_1-0',
      status: null,
      durationMs: null,
      initiator: null,
      resourceType: null,
    });
  });
});
