import { LIMITS, type CapturedRequest, type NavigationEvent } from '@api-qa/contracts';
import { describe, expect, it } from 'vitest';

import { CHUNK_SIZE, MemoryStore, SessionRepository } from '../src/index.js';

function capturedRequest(index: number): CapturedRequest {
  return {
    id: `r${String(index)}`,
    timestamp: 1_000 + index,
    source: 'extension-webrequest',
    method: 'GET',
    origin: 'https://app.test',
    path: '/api/items',
    url: 'https://app.test/api/items',
    resourceType: 'api',
    status: 200,
    error: null,
    durationMs: 5,
    initiator: 'https://app.test',
    context: { tabId: 1, frameId: 0, documentId: 'doc' },
    fingerprint: {
      endpoint: 'GET https://app.test/api/items',
      requestKey: '0123456789abcdef',
      bodyHash: null,
      bodyStatus: 'absent',
    },
  };
}

const range = (from: number, count: number): CapturedRequest[] =>
  Array.from({ length: count }, (_, i) => capturedRequest(from + i));

const NAVIGATION: NavigationEvent = {
  id: 'n1',
  timestamp: 900,
  url: 'https://app.test/',
  context: { tabId: 1, frameId: 0, documentId: 'doc' },
};

async function freshRepository(id = 's1', startedAt = 1_000) {
  const store = new MemoryStore();
  const repository = new SessionRepository(store);
  await repository.create({ id, name: 'Run', source: 'extension-webrequest', startedAt });
  return { store, repository };
}

async function loadOk(repository: SessionRepository, id = 's1') {
  const result = await repository.load(id);
  if (!result.ok) {
    throw new Error(result.issues.join('; '));
  }
  return result.value;
}

describe('SessionRepository', () => {
  it('creates an empty, valid session and lists it', async () => {
    const { repository } = await freshRepository();
    const session = await loadOk(repository);
    expect(session).toMatchObject({
      id: 's1',
      requests: [],
      endedAt: null,
      droppedRequestCount: 0,
    });
    expect(await repository.list()).toEqual([
      {
        id: 's1',
        name: 'Run',
        source: 'extension-webrequest',
        startedAt: 1_000,
        endedAt: null,
        requestCount: 0,
        droppedRequestCount: 0,
      },
    ]);
  });

  it('refuses to create a session twice or with an invalid id', async () => {
    const { repository } = await freshRepository();
    await expect(
      repository.create({ id: 's1', name: 'Again', source: 'playwright', startedAt: 1 }),
    ).rejects.toThrow('already exists');
    await expect(
      repository.create({ id: 'bad id', name: 'x', source: 'playwright', startedAt: 1 }),
    ).rejects.toThrow();
  });

  it('stores requests in fixed-size chunks across chunk boundaries', async () => {
    const { store, repository } = await freshRepository();
    await repository.appendRequests('s1', range(0, 10));
    await repository.appendRequests('s1', range(10, CHUNK_SIZE));
    await repository.appendRequests('s1', range(10 + CHUNK_SIZE, 1));
    const session = await loadOk(repository);
    expect(session.requests.map((request) => request.id)).toEqual(
      range(0, CHUNK_SIZE + 11).map((request) => request.id),
    );
    expect(store.keys().filter((key) => key.includes(':chunk:'))).toEqual([
      'session:s1:chunk:0',
      'session:s1:chunk:1',
    ]);
  });

  it('does not lose writes when appends overlap', async () => {
    const { repository } = await freshRepository();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => repository.appendRequests('s1', range(i * 30, 30))),
    );
    expect((await loadOk(repository)).requests).toHaveLength(600);
    expect((await repository.list())[0]?.requestCount).toBe(600);
  });

  it('counts requests beyond the session limit as dropped', async () => {
    const { repository } = await freshRepository();
    const first = await repository.appendRequests('s1', range(0, LIMITS.requestsPerSession - 1));
    expect(first).toEqual({ stored: LIMITS.requestsPerSession - 1, dropped: 0 });
    expect(await repository.appendRequests('s1', range(LIMITS.requestsPerSession, 3))).toEqual({
      stored: 1,
      dropped: 2,
    });
    const summary = (await repository.list())[0];
    expect(summary).toMatchObject({
      requestCount: LIMITS.requestsPerSession,
      droppedRequestCount: 2,
    });
  });

  it('records navigations, dropped counts and the end time', async () => {
    const { repository } = await freshRepository();
    await repository.appendNavigations('s1', [NAVIGATION]);
    await repository.addDropped('s1', 3);
    await repository.addDropped('s1', -5);
    await repository.end('s1', 5_000);
    const session = await loadOk(repository);
    expect(session.navigations).toEqual([NAVIGATION]);
    expect(session.droppedRequestCount).toBe(3);
    expect(session.endedAt).toBe(5_000);
  });

  it('never records an end before the start', async () => {
    const { repository } = await freshRepository();
    await repository.end('s1', 10);
    expect((await loadOk(repository)).endedAt).toBe(1_000);
  });

  it('stores triage decisions and treats "open" as no entry', async () => {
    const { repository } = await freshRepository();
    await repository.setTriage('s1', 'duplicate-request:0123456789abcdef', 'expected');
    expect((await loadOk(repository)).triage).toEqual({
      'duplicate-request:0123456789abcdef': 'expected',
    });
    await repository.setTriage('s1', 'duplicate-request:0123456789abcdef', 'open');
    expect((await loadOk(repository)).triage).toEqual({});
  });

  it('rejects triage for an invalid finding id', async () => {
    const { repository } = await freshRepository();
    await expect(repository.setTriage('s1', '<script>', 'confirmed')).rejects.toThrow();
  });

  it('reports a missing or corrupt session instead of trusting it', async () => {
    const { store, repository } = await freshRepository();
    expect(await repository.load('nope')).toEqual({
      ok: false,
      issues: ['Session nope does not exist or is corrupt'],
    });
    await repository.appendRequests('s1', range(0, 2));
    await store.set({ 'session:s1:chunk:0': [{ id: 'evil', url: 'javascript:alert(1)' }] });
    const result = await repository.load('s1');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues[0]).toMatch(/^session:s1:chunk:0: /);
    await store.set({ 'session:s1:meta': { schemaVersion: 99 } });
    expect((await repository.load('s1')).ok).toBe(false);
    await expect(repository.appendRequests('s1', range(0, 1))).rejects.toThrow('corrupt');
  });

  it('reads a corrupt index as empty', async () => {
    const { store, repository } = await freshRepository();
    await store.set({ 'sessions:index': 'garbage' });
    expect(await repository.list()).toEqual([]);
  });

  it('deletes one session with all its chunks, or everything', async () => {
    const { store, repository } = await freshRepository();
    await repository.create({ id: 's2', name: 'Two', source: 'playwright', startedAt: 2_000 });
    await repository.appendRequests('s1', range(0, CHUNK_SIZE + 1));
    await repository.delete('s1');
    expect(store.keys()).toEqual(['session:s2:meta', 'sessions:index']);
    expect((await repository.list()).map((summary) => summary.id)).toEqual(['s2']);
    await repository.clear();
    expect(store.keys()).toEqual([]);
  });

  it('keeps working after a failed operation', async () => {
    const { repository } = await freshRepository();
    await expect(repository.appendRequests('missing', range(0, 1))).rejects.toThrow();
    expect((await repository.appendRequests('s1', range(0, 1))).stored).toBe(1);
  });

  describe('prune', () => {
    const DAY = 86_400_000;

    async function sessions(count: number) {
      const store = new MemoryStore();
      const repository = new SessionRepository(store);
      for (let i = 0; i < count; i++) {
        const id = `s${String(i)}`;
        await repository.create({ id, name: id, source: 'playwright', startedAt: i * DAY });
        await repository.end(id, i * DAY + 1);
      }
      return repository;
    }

    it('deletes the oldest finished sessions beyond the limit', async () => {
      const repository = await sessions(5);
      const now = 5 * DAY;
      expect(await repository.prune(now, { maxSessions: 3, maxAgeDays: 365 })).toEqual([
        's0',
        's1',
      ]);
      expect((await repository.list()).map((summary) => summary.id)).toEqual(['s2', 's3', 's4']);
    });

    it('deletes sessions older than the age limit', async () => {
      const repository = await sessions(4);
      expect(await repository.prune(4 * DAY, { maxSessions: 100, maxAgeDays: 2 })).toEqual([
        's0',
        's1',
      ]);
    });

    it('never deletes a session that is still capturing', async () => {
      const repository = new SessionRepository(new MemoryStore());
      await repository.create({ id: 'live', name: 'Live', source: 'playwright', startedAt: 0 });
      await repository.create({ id: 'done', name: 'Done', source: 'playwright', startedAt: 1 });
      await repository.end('done', 2);
      expect(await repository.prune(1_000 * DAY, { maxSessions: 1, maxAgeDays: 1 })).toEqual([
        'done',
      ]);
      expect((await repository.list()).map((summary) => summary.id)).toEqual(['live']);
    });

    it('uses the default policy', async () => {
      const repository = await sessions(2);
      expect(await repository.prune(2 * DAY)).toEqual([]);
    });
  });
});
