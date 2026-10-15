import { normalizeNavigation, normalizeRequest } from '@api-qa/core';
import type { CapturedRequest, DetectionRuleSet, RawRequestObservation } from '@api-qa/contracts';
import type { KeyValueStore, SessionRepository, SettingsRepository } from '@api-qa/storage';

import { captureStateSchema, type CaptureState, type CaptureStatus } from '../shared/messages.js';
import { httpOrigin } from '../shared/origins.js';
import {
  RequestTracker,
  type BeforeRequestEvent,
  type ErrorEvent,
  type ResponseEvent,
} from './request-tracker.js';

const STATE_KEY = 'capture:state';
/** Captured requests are written in batches of this size, or after FLUSH_DELAY_MS. */
const FLUSH_SIZE = 50;
export const FLUSH_DELAY_MS = 250;

export interface NavigationCommittedEvent {
  readonly tabId: number;
  readonly frameId: number;
  readonly url: string;
  readonly timeStamp: number;
  readonly documentId?: string | undefined;
}

export interface CaptureDependencies {
  readonly sessions: SessionRepository;
  readonly settings: SettingsRepository;
  /** chrome.storage.session: survives service-worker restarts, cleared when the browser closes. */
  readonly state: KeyValueStore;
  readonly now: () => number;
  readonly newId: () => string;
  /** Whether the extension holds host permission for every origin. */
  readonly hasHostPermission: (origins: readonly string[]) => Promise<boolean>;
  readonly schedule: (callback: () => void, delayMs: number) => void;
}

export interface StartRequest {
  readonly tabId: number;
  readonly origins: readonly string[];
  readonly name: string;
}

export class CaptureError extends Error {
  override name = 'CaptureError';
}

/**
 * Owns capture: the only writer of sessions while capturing. Every event is
 * processed in order through one queue, after the persisted capture state has
 * been loaded, so events that wake a suspended worker are not lost.
 */
export class CaptureController {
  readonly #deps: CaptureDependencies;
  readonly #tracker = new RequestTracker();
  #state: CaptureState = { active: false };
  #ruleSet: DetectionRuleSet | null = null;
  #queue: Promise<unknown>;
  #buffer: CapturedRequest[] = [];
  #bufferedDrops = 0;
  #flushScheduled = false;
  #navigationCounter = 0;

  constructor(deps: CaptureDependencies) {
    this.#deps = deps;
    this.#queue = this.#loadState();
  }

  async #loadState(): Promise<void> {
    const raw = (await this.#deps.state.get([STATE_KEY]))[STATE_KEY];
    const parsed = captureStateSchema.safeParse(raw);
    this.#state = parsed.success ? parsed.data : { active: false };
  }

  #enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(task, task);
    this.#queue = result.catch(() => undefined);
    return result;
  }

  async #rules(): Promise<DetectionRuleSet> {
    this.#ruleSet ??= (await this.#deps.settings.getRuleSet()).ruleSet;
    return this.#ruleSet;
  }

  /** Call after the rule set changes so normalisation uses the new options. */
  reloadRules(): void {
    this.#ruleSet = null;
  }

  #captures(tabId: number, url: string): boolean {
    const state = this.#state;
    if (!state.active || tabId !== state.tabId) {
      return false;
    }
    const origin = httpOrigin(url);
    return origin !== null && state.origins.includes(origin);
  }

  async #record(observation: RawRequestObservation): Promise<void> {
    if (!this.#state.active) {
      return;
    }
    const result = normalizeRequest(observation, (await this.#rules()).normalization);
    if (result.ok) {
      this.#buffer.push(result.request);
    } else {
      this.#bufferedDrops++;
    }
    if (this.#buffer.length >= FLUSH_SIZE) {
      await this.#flushUnlocked();
    } else if (!this.#flushScheduled) {
      this.#flushScheduled = true;
      this.#deps.schedule(() => void this.flush(), FLUSH_DELAY_MS);
    }
  }

  async #flushUnlocked(): Promise<void> {
    this.#flushScheduled = false;
    const state = this.#state;
    const requests = this.#buffer;
    const drops = this.#bufferedDrops;
    this.#buffer = [];
    this.#bufferedDrops = 0;
    if (!state.active) {
      return;
    }
    if (requests.length > 0) {
      await this.#deps.sessions.appendRequests(state.sessionId, requests);
    }
    if (drops > 0) {
      await this.#deps.sessions.addDropped(state.sessionId, drops);
    }
  }

  /** Writes buffered requests now. */
  flush(): Promise<void> {
    return this.#enqueue(() => this.#flushUnlocked());
  }

  onBeforeRequest(event: BeforeRequestEvent): Promise<void> {
    return this.#enqueue(() => {
      if (this.#captures(event.tabId, event.url)) {
        this.#tracker.begin(event);
      }
      return Promise.resolve();
    });
  }

  onRedirect(event: ResponseEvent): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#captures(event.tabId, event.url)) {
        await this.#record(this.#tracker.redirect(event));
      }
    });
  }

  onCompleted(event: ResponseEvent): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#captures(event.tabId, event.url)) {
        await this.#record(this.#tracker.complete(event));
      }
    });
  }

  onError(event: ErrorEvent): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#captures(event.tabId, event.url)) {
        await this.#record(this.#tracker.fail(event));
      }
    });
  }

  /** Top-level navigations in the captured tab, for the request-after-navigation detector. */
  onNavigation(event: NavigationCommittedEvent): Promise<void> {
    return this.#enqueue(async () => {
      const state = this.#state;
      if (!state.active || event.tabId !== state.tabId || event.frameId !== 0) {
        return;
      }
      this.#navigationCounter++;
      const result = normalizeNavigation(
        {
          id: `nav-${String(Math.round(event.timeStamp))}-${String(this.#navigationCounter)}`,
          timestamp: event.timeStamp,
          url: event.url,
          context: { tabId: event.tabId, frameId: 0, documentId: event.documentId ?? null },
        },
        (await this.#rules()).normalization,
      );
      if (result.ok) {
        await this.#flushUnlocked();
        await this.#deps.sessions.appendNavigations(state.sessionId, [result.navigation]);
      }
    });
  }

  /** Closing the captured tab ends the capture. */
  onTabRemoved(tabId: number): Promise<void> {
    return this.#enqueue(async () => {
      if (this.#state.active && this.#state.tabId === tabId) {
        await this.#stopUnlocked();
      }
    });
  }

  async #statusUnlocked(): Promise<CaptureStatus> {
    const state = this.#state;
    if (!state.active) {
      return { active: false };
    }
    const summary = (await this.#deps.sessions.list()).find(
      (candidate) => candidate.id === state.sessionId,
    );
    return {
      ...state,
      requestCount: summary?.requestCount ?? 0,
      droppedRequestCount: summary?.droppedRequestCount ?? 0,
    };
  }

  status(): Promise<CaptureStatus> {
    return this.#enqueue(async () => {
      await this.#flushUnlocked();
      return this.#statusUnlocked();
    });
  }

  start(request: StartRequest): Promise<CaptureStatus> {
    return this.#enqueue(async () => {
      if (this.#state.active) {
        throw new CaptureError('A capture is already running. Stop it first.');
      }
      if (!(await this.#deps.hasHostPermission(request.origins))) {
        throw new CaptureError(
          'Site access has not been granted for every origin. Grant it from the popup and try again.',
        );
      }
      const startedAt = this.#deps.now();
      const sessionId = `session-${this.#deps.newId()}`;
      await this.#deps.sessions.create({
        id: sessionId,
        name: request.name,
        source: 'extension-webrequest',
        startedAt,
      });
      this.#state = {
        active: true,
        sessionId,
        tabId: request.tabId,
        origins: [...request.origins],
        startedAt,
      };
      this.#ruleSet = null;
      await this.#deps.state.set({ [STATE_KEY]: this.#state });
      return this.#statusUnlocked();
    });
  }

  async #stopUnlocked(): Promise<void> {
    const state = this.#state;
    if (!state.active) {
      return;
    }
    await this.#flushUnlocked();
    await this.#deps.sessions.end(state.sessionId, this.#deps.now());
    this.#state = { active: false };
    await this.#deps.state.set({ [STATE_KEY]: this.#state });
    await this.#deps.sessions.prune(this.#deps.now(), await this.#deps.settings.getRetention());
  }

  stop(): Promise<CaptureStatus> {
    return this.#enqueue(async () => {
      await this.#stopUnlocked();
      return this.#statusUnlocked();
    });
  }

  /** Runs a session mutation in the capture queue, so it never races with appends. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    return this.#enqueue(async () => {
      await this.#flushUnlocked();
      return task();
    });
  }

  /** The session currently being captured, if any. */
  get activeSessionId(): string | null {
    return this.#state.active ? this.#state.sessionId : null;
  }
}
