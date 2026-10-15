import {
  LIMITS,
  capturedRequestSchema,
  parseCaptureSession,
  parseWith,
  type CaptureSession,
  type CapturedRequest,
  type CaptureSource,
  type NavigationEvent,
  type ParseResult,
  type TriageStatus,
} from '@api-qa/contracts';
import { z } from 'zod';

import type { KeyValueStore } from './key-value-store.js';
import {
  CHUNK_SIZE,
  DEFAULT_RETENTION,
  sessionIndexSchema,
  sessionMetaSchema,
  type RetentionPolicy,
  type SessionIndex,
  type SessionMeta,
  type SessionSummary,
} from './schemas.js';

const INDEX_KEY = 'sessions:index';
const metaKey = (id: string): string => `session:${id}:meta`;
const chunkKey = (id: string, index: number): string => `session:${id}:chunk:${String(index)}`;

const chunkSchema = z.array(capturedRequestSchema).max(CHUNK_SIZE);
const DAY_MS = 86_400_000;

export interface NewSession {
  readonly id: string;
  readonly name: string;
  readonly source: CaptureSource;
  readonly startedAt: number;
}

export interface AppendResult {
  readonly stored: number;
  /** Requests refused because the session reached LIMITS.requestsPerSession. */
  readonly dropped: number;
}

function summaryOf(meta: SessionMeta): SessionSummary {
  return {
    id: meta.id,
    name: meta.name,
    source: meta.source,
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    requestCount: meta.requestCount,
    droppedRequestCount: meta.droppedRequestCount,
  };
}

/**
 * Stores capture sessions in a key-value store: an index, one metadata
 * record per session, and requests in fixed-size chunks.
 *
 * Mutations are serialised, so overlapping calls (several webRequest events
 * in one tick) never lose writes to read-modify-write races. Everything read
 * back is validated; corrupt records are reported, not trusted.
 */
export class SessionRepository {
  readonly #store: KeyValueStore;
  #queue: Promise<unknown> = Promise.resolve();

  constructor(store: KeyValueStore) {
    this.#store = store;
  }

  #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #readIndex(): Promise<SessionIndex> {
    const raw = (await this.#store.get([INDEX_KEY]))[INDEX_KEY];
    const parsed = sessionIndexSchema.safeParse(raw);
    return parsed.success ? parsed.data : { schemaVersion: 1, sessions: [] };
  }

  async #readMeta(id: string): Promise<SessionMeta | null> {
    const raw = (await this.#store.get([metaKey(id)]))[metaKey(id)];
    const parsed = sessionMetaSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }

  async #requireMeta(id: string): Promise<SessionMeta> {
    const meta = await this.#readMeta(id);
    if (meta === null) {
      throw new Error(`Session ${id} does not exist or is corrupt`);
    }
    return meta;
  }

  async #writeMeta(meta: SessionMeta): Promise<void> {
    const index = await this.#readIndex();
    const sessions = [
      ...index.sessions.filter((summary) => summary.id !== meta.id),
      summaryOf(meta),
    ].sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));
    await this.#store.set({
      [metaKey(meta.id)]: meta,
      [INDEX_KEY]: { schemaVersion: 1, sessions },
    });
  }

  async #deleteUnlocked(id: string): Promise<void> {
    const meta = await this.#readMeta(id);
    const chunkCount = meta?.chunkCount ?? 0;
    await this.#store.remove([
      metaKey(id),
      ...Array.from({ length: chunkCount }, (_, index) => chunkKey(id, index)),
    ]);
    const index = await this.#readIndex();
    await this.#store.set({
      [INDEX_KEY]: {
        schemaVersion: 1,
        sessions: index.sessions.filter((summary) => summary.id !== id),
      },
    });
  }

  /** Sessions, oldest first. A corrupt index reads as empty. */
  async list(): Promise<SessionSummary[]> {
    return (await this.#readIndex()).sessions;
  }

  create(session: NewSession): Promise<void> {
    return this.#exclusive(async () => {
      if ((await this.#readMeta(session.id)) !== null) {
        throw new Error(`Session ${session.id} already exists`);
      }
      const meta = sessionMetaSchema.parse({
        schemaVersion: 1,
        ...session,
        endedAt: null,
        requestCount: 0,
        chunkCount: 0,
        navigations: [],
        droppedRequestCount: 0,
        triage: {},
      });
      await this.#writeMeta(meta);
    });
  }

  /** Appends sanitised requests. Requests over the session limit are counted as dropped. */
  appendRequests(id: string, requests: readonly CapturedRequest[]): Promise<AppendResult> {
    return this.#exclusive(async () => {
      const meta = await this.#requireMeta(id);
      const room = LIMITS.requestsPerSession - meta.requestCount;
      const accepted = requests.slice(0, Math.max(0, room));
      const dropped = requests.length - accepted.length;

      let chunkCount = meta.chunkCount;
      let pending = [...accepted];
      const writes: Record<string, unknown> = {};
      if (chunkCount > 0 && meta.requestCount % CHUNK_SIZE !== 0 && pending.length > 0) {
        const lastKey = chunkKey(id, chunkCount - 1);
        const last = chunkSchema.safeParse((await this.#store.get([lastKey]))[lastKey]);
        const existing = last.success ? last.data : [];
        const fill = pending.slice(0, CHUNK_SIZE - existing.length);
        writes[lastKey] = [...existing, ...fill];
        pending = pending.slice(fill.length);
      }
      while (pending.length > 0) {
        writes[chunkKey(id, chunkCount)] = pending.slice(0, CHUNK_SIZE);
        pending = pending.slice(CHUNK_SIZE);
        chunkCount++;
      }
      await this.#store.set(writes);
      await this.#writeMeta({
        ...meta,
        requestCount: meta.requestCount + accepted.length,
        chunkCount,
        droppedRequestCount: meta.droppedRequestCount + dropped,
      });
      return { stored: accepted.length, dropped };
    });
  }

  /** Records navigations; beyond LIMITS.navigationsPerSession they are ignored. */
  appendNavigations(id: string, navigations: readonly NavigationEvent[]): Promise<void> {
    return this.#exclusive(async () => {
      const meta = await this.#requireMeta(id);
      const all = [...meta.navigations, ...navigations].slice(0, LIMITS.navigationsPerSession);
      await this.#writeMeta({ ...meta, navigations: all });
    });
  }

  /** Counts requests the capture saw but could not record (rejected by normalisation). */
  addDropped(id: string, count: number): Promise<void> {
    return this.#exclusive(async () => {
      const meta = await this.#requireMeta(id);
      await this.#writeMeta({
        ...meta,
        droppedRequestCount: meta.droppedRequestCount + Math.max(0, Math.floor(count)),
      });
    });
  }

  end(id: string, endedAt: number): Promise<void> {
    return this.#exclusive(async () => {
      const meta = await this.#requireMeta(id);
      await this.#writeMeta({ ...meta, endedAt: Math.max(endedAt, meta.startedAt) });
    });
  }

  setTriage(id: string, findingId: string, status: TriageStatus): Promise<void> {
    return this.#exclusive(async () => {
      const meta = await this.#requireMeta(id);
      // `open` is the default, so it is stored as the absence of an entry.
      const triage = Object.fromEntries([
        ...Object.entries(meta.triage).filter(([key]) => key !== findingId),
        ...(status === 'open' ? [] : [[findingId, status] as const]),
      ]);
      await this.#writeMeta(sessionMetaSchema.parse({ ...meta, triage }));
    });
  }

  /** Loads and validates a full session. */
  load(id: string): Promise<ParseResult<CaptureSession>> {
    return this.#exclusive(async () => {
      const meta = await this.#readMeta(id);
      if (meta === null) {
        return { ok: false, issues: [`Session ${id} does not exist or is corrupt`] };
      }
      const keys = Array.from({ length: meta.chunkCount }, (_, index) => chunkKey(id, index));
      const stored = await this.#store.get(keys);
      const requests: CapturedRequest[] = [];
      for (const key of keys) {
        const chunk = parseWith(chunkSchema, stored[key]);
        if (!chunk.ok) {
          return { ok: false, issues: chunk.issues.map((issue) => `${key}: ${issue}`) };
        }
        requests.push(...chunk.value);
      }
      return parseCaptureSession({
        schemaVersion: meta.schemaVersion,
        id: meta.id,
        name: meta.name,
        source: meta.source,
        startedAt: meta.startedAt,
        endedAt: meta.endedAt,
        requests,
        navigations: meta.navigations,
        droppedRequestCount: meta.droppedRequestCount,
        triage: meta.triage,
      });
    });
  }

  delete(id: string): Promise<void> {
    return this.#exclusive(() => this.#deleteUnlocked(id));
  }

  /** Deletes every session. */
  clear(): Promise<void> {
    return this.#exclusive(async () => {
      for (const summary of (await this.#readIndex()).sessions) {
        await this.#deleteUnlocked(summary.id);
      }
      await this.#store.remove([INDEX_KEY]);
    });
  }

  /**
   * Applies the retention policy and returns the ids it deleted. Sessions still
   * capturing (`endedAt === null`) are never deleted.
   */
  prune(now: number, policy: RetentionPolicy = DEFAULT_RETENTION): Promise<string[]> {
    return this.#exclusive(async () => {
      const sessions = (await this.#readIndex()).sessions; // oldest first
      const expired = new Set(
        sessions
          .filter(
            (summary) =>
              summary.endedAt !== null && now - summary.endedAt > policy.maxAgeDays * DAY_MS,
          )
          .map((summary) => summary.id),
      );
      const remaining = sessions.filter((summary) => !expired.has(summary.id));
      const surplus = remaining
        .filter((summary) => summary.endedAt !== null)
        .slice(0, Math.max(0, remaining.length - policy.maxSessions))
        .map((summary) => summary.id);
      const doomed = [...expired, ...surplus];
      for (const id of doomed) {
        await this.#deleteUnlocked(id);
      }
      return doomed;
    });
  }
}
