import { MemoryStore, SessionRepository, SettingsRepository } from '@api-qa/storage';
import { describe, expect, it } from 'vitest';

import {
  CaptureController,
  CaptureError,
  FLUSH_DELAY_MS,
  type CaptureDependencies,
} from '../src/background/capture-controller.js';
import type { BeforeRequestEvent, ResponseEvent } from '../src/background/request-tracker.js';

const ORIGIN = 'https://shop.test';

interface Harness {
  readonly controller: CaptureController;
  readonly sessions: SessionRepository;
  readonly settings: SettingsRepository;
  readonly stateStore: MemoryStore;
  readonly timers: (() => void)[];
  readonly deps: CaptureDependencies;
}

function harness(
  overrides: Partial<CaptureDependencies> = {},
  stateStore = new MemoryStore(),
): Harness {
  const local = new MemoryStore();
  const sessions = new SessionRepository(local);
  const settings = new SettingsRepository(local);
  const timers: (() => void)[] = [];
  let clock = 10_000;
  let ids = 0;
  const deps: CaptureDependencies = {
    sessions,
    settings,
    state: stateStore,
    now: () => clock++,
    newId: () => `id${String(++ids)}`,
    hasHostPermission: () => Promise.resolve(true),
    schedule: (callback) => {
      timers.push(callback);
    },
    ...overrides,
  };
  return { controller: new CaptureController(deps), sessions, settings, stateStore, timers, deps };
}

let requestCounter = 0;
function request(overrides: Partial<BeforeRequestEvent> = {}): [BeforeRequestEvent, ResponseEvent] {
  requestCounter++;
  const start: BeforeRequestEvent = {
    requestId: String(requestCounter),
    url: `${ORIGIN}/api/cart`,
    method: 'GET',
    tabId: 7,
    frameId: 0,
    type: 'xmlhttprequest',
    timeStamp: 20_000 + requestCounter,
    documentId: 'DOC1',
    ...overrides,
  };
  return [start, { ...start, statusCode: 200, timeStamp: start.timeStamp + 5 }];
}

async function send(
  controller: CaptureController,
  ...events: [BeforeRequestEvent, ResponseEvent][]
) {
  for (const [start, end] of events) {
    await controller.onBeforeRequest(start);
    await controller.onCompleted(end);
  }
}

async function startCapture(h: Harness) {
  return h.controller.start({ tabId: 7, origins: [ORIGIN], name: 'Checkout' });
}

async function storedSession(h: Harness, sessionId: string) {
  const loaded = await h.sessions.load(sessionId);
  if (!loaded.ok) {
    throw new Error(loaded.issues.join('; '));
  }
  return loaded.value;
}

describe('CaptureController', () => {
  it('starts inactive', async () => {
    expect(await harness().controller.status()).toEqual({ active: false });
  });

  it('captures only the chosen tab and origins, sanitised, and flushes on a timer', async () => {
    const h = harness();
    const status = await startCapture(h);
    expect(status).toMatchObject({
      active: true,
      sessionId: 'session-id1',
      tabId: 7,
      requestCount: 0,
    });
    await send(
      h.controller,
      request({ url: `${ORIGIN}/api/cart?token=secret-value` }),
      request({ tabId: 8 }),
      request({ url: 'https://elsewhere.test/api/x' }),
      request({ url: 'not a url' }),
    );
    expect((await h.sessions.list())[0]?.requestCount).toBe(0);
    expect(h.timers).toHaveLength(1);
    h.timers[0]?.();
    await h.controller.flush();
    const session = await storedSession(h, 'session-id1');
    expect(session.requests.map((stored) => stored.url)).toEqual([
      `${ORIGIN}/api/cart?token=[REDACTED]`,
    ]);
    expect(JSON.stringify(session)).not.toContain('secret-value');
  });

  it('writes a full batch without waiting for the timer', async () => {
    const h = harness();
    await startCapture(h);
    await send(h.controller, ...Array.from({ length: 50 }, () => request()));
    expect((await h.sessions.list())[0]?.requestCount).toBe(50);
  });

  it('counts requests that normalisation rejects as dropped', async () => {
    const h = harness();
    await startCapture(h);
    await send(h.controller, request({ method: 'BREW' }));
    expect(await h.controller.status()).toMatchObject({ requestCount: 0, droppedRequestCount: 1 });
  });

  it('records redirects and network errors', async () => {
    const h = harness();
    await startCapture(h);
    const [start, end] = request();
    await h.controller.onBeforeRequest(start);
    await h.controller.onRedirect({ ...end, statusCode: 307 });
    await h.controller.onBeforeRequest(start);
    await h.controller.onError({
      ...start,
      error: 'net::ERR_CONNECTION_RESET',
      timeStamp: start.timeStamp + 9,
    });
    await h.controller.stop();
    const session = await storedSession(h, 'session-id1');
    expect(session.requests.map((stored) => [stored.status, stored.error])).toEqual([
      [307, null],
      [null, 'net::ERR_CONNECTION_RESET'],
    ]);
  });

  it('records top-level navigations of the captured tab only', async () => {
    const h = harness();
    await startCapture(h);
    await h.controller.onNavigation({
      tabId: 7,
      frameId: 0,
      url: `${ORIGIN}/checkout?session=abc`,
      timeStamp: 30_000,
      documentId: 'DOC2',
    });
    await h.controller.onNavigation({
      tabId: 7,
      frameId: 3,
      url: `${ORIGIN}/frame`,
      timeStamp: 30_001,
    });
    await h.controller.onNavigation({
      tabId: 9,
      frameId: 0,
      url: `${ORIGIN}/other`,
      timeStamp: 30_002,
    });
    await h.controller.onNavigation({ tabId: 7, frameId: 0, url: 'invalid', timeStamp: 30_003 });
    const session = await storedSession(h, 'session-id1');
    expect(session.navigations).toEqual([
      {
        id: 'nav-30000-1',
        timestamp: 30_000,
        url: `${ORIGIN}/checkout?session=[REDACTED]`,
        context: { tabId: 7, frameId: 0, documentId: 'DOC2' },
      },
    ]);
  });

  it('stops: flushes, ends the session and applies retention', async () => {
    const h = harness();
    await h.settings.saveRetention({ maxSessions: 1 });
    await startCapture(h);
    await h.controller.stop();
    await startCapture(h);
    await send(h.controller, request());
    expect(await h.controller.stop()).toEqual({ active: false });
    const summaries = await h.sessions.list();
    expect(summaries.map((summary) => summary.id)).toEqual(['session-id2']);
    expect(summaries[0]).toMatchObject({ requestCount: 1 });
    expect(summaries[0]?.endedAt).not.toBeNull();
  });

  it('ignores events after stopping and stopping twice is harmless', async () => {
    const h = harness();
    await startCapture(h);
    await h.controller.stop();
    await send(h.controller, request());
    await h.controller.onNavigation({ tabId: 7, frameId: 0, url: ORIGIN, timeStamp: 1 });
    expect(await h.controller.stop()).toEqual({ active: false });
    expect((await h.sessions.list())[0]?.requestCount).toBe(0);
  });

  it('refuses a second capture and a capture without site access', async () => {
    const h = harness();
    await startCapture(h);
    await expect(startCapture(h)).rejects.toBeInstanceOf(CaptureError);
    const denied = harness({ hasHostPermission: () => Promise.resolve(false) });
    await expect(startCapture(denied)).rejects.toThrow('Site access has not been granted');
    expect(await denied.sessions.list()).toEqual([]);
  });

  it('ends the capture when its tab closes', async () => {
    const h = harness();
    await startCapture(h);
    await h.controller.onTabRemoved(99);
    expect((await h.controller.status()).active).toBe(true);
    await h.controller.onTabRemoved(7);
    expect(await h.controller.status()).toEqual({ active: false });
  });

  it('resumes capturing after a service-worker restart', async () => {
    const stateStore = new MemoryStore();
    const first = harness({}, stateStore);
    await startCapture(first);
    // A new controller over the same storage, as after the worker was suspended.
    const restarted = new CaptureController({ ...first.deps, state: stateStore });
    const [, end] = request();
    await restarted.onCompleted(end);
    await restarted.flush();
    const session = await storedSession(first, 'session-id1');
    expect(session.requests).toHaveLength(1);
    expect(session.requests[0]?.durationMs).toBeNull();
  });

  it('treats corrupt persisted state as not capturing', async () => {
    const stateStore = new MemoryStore();
    await stateStore.set({ 'capture:state': { active: true, tabId: 'x' } });
    expect(await harness({}, stateStore).controller.status()).toEqual({ active: false });
  });

  it('uses updated normalisation rules after reloadRules', async () => {
    const h = harness();
    await startCapture(h);
    await h.settings.saveRuleSet({
      schemaVersion: 1,
      name: 'Tenant',
      normalization: { sensitiveNames: ['tenant'] },
    });
    h.controller.reloadRules();
    await send(h.controller, request({ url: `${ORIGIN}/api/cart?tenant=acme` }));
    await h.controller.flush();
    expect((await storedSession(h, 'session-id1')).requests[0]?.url).toBe(
      `${ORIGIN}/api/cart?tenant=[REDACTED]`,
    );
  });

  it('runs session mutations after queued events, with buffered requests written first', async () => {
    const h = harness();
    await startCapture(h);
    const [start, end] = request();
    await h.controller.onBeforeRequest(start);
    // Not awaited: the completion is queued ahead of the mutation.
    const completed = h.controller.onCompleted(end);
    const seenCount = await h.controller.exclusive(
      async () => (await h.sessions.list())[0]?.requestCount,
    );
    await completed;
    expect(seenCount).toBe(1);
    expect(h.controller.activeSessionId).toBe('session-id1');
  });

  it('schedules at most one pending flush', async () => {
    const h = harness();
    await startCapture(h);
    await send(h.controller, request(), request(), request());
    expect(h.timers).toHaveLength(1);
    expect(FLUSH_DELAY_MS).toBeGreaterThan(0);
  });
});
