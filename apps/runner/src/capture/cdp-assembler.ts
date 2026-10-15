import type { RawBody, RawNavigationObservation, RawRequestObservation } from '@api-qa/contracts';

// The Chrome DevTools Protocol fields the assembler reads. Playwright's CDP
// event payloads satisfy these structurally.

export interface CdpRequestWillBeSent {
  readonly requestId: string;
  readonly loaderId: string;
  readonly documentURL: string;
  readonly frameId?: string | undefined;
  readonly type?: string | undefined;
  /** Seconds, monotonic clock. */
  readonly timestamp: number;
  /** Seconds since the Unix epoch. */
  readonly wallTime: number;
  readonly request: {
    readonly url: string;
    readonly method: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly postData?: string | undefined;
    readonly hasPostData?: boolean | undefined;
  };
  readonly redirectResponse?: { readonly status: number } | undefined;
}

export interface CdpResponseReceived {
  readonly requestId: string;
  readonly response: { readonly status: number };
}

export interface CdpLoadingFinished {
  readonly requestId: string;
  readonly timestamp: number;
}

export interface CdpLoadingFailed {
  readonly requestId: string;
  readonly timestamp: number;
  readonly errorText: string;
}

export interface CdpFrameNavigated {
  readonly frame: {
    readonly id: string;
    readonly parentId?: string | undefined;
    readonly loaderId: string;
    readonly url: string;
  };
}

export interface CdpNavigatedWithinDocument {
  readonly frameId: string;
  readonly url: string;
}

interface Pending {
  readonly start: CdpRequestWillBeSent;
  readonly hop: number;
  status: number | null;
}

export interface CapturedEvents {
  readonly requests: readonly RawRequestObservation[];
  readonly navigations: readonly RawNavigationObservation[];
}

function headerValue(headers: Readonly<Record<string, string>>, name: string): string | null {
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  return key === undefined ? null : (headers[key] ?? null);
}

/** Only Content-Type is read from headers, to classify the body; headers are never kept. */
export function bodyOf(request: CdpRequestWillBeSent['request']): RawBody {
  if (request.postData !== undefined) {
    return {
      kind: 'text',
      text: request.postData,
      contentType: headerValue(request.headers, 'content-type'),
    };
  }
  if (request.hasPostData === true) {
    // The body exists but was too large to be inlined in the event.
    return { kind: 'unavailable' };
  }
  // CDP reports bodies explicitly, so no postData and no hasPostData means none was sent.
  return { kind: 'absent' };
}

function isHttp(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function originOrNull(url: string): string | null {
  try {
    const parsed = new URL(url);
    return isHttp(url) ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * Turns CDP Network and Page events for one page into raw observations, the
 * same input the extension produces. Requests are attributed to the document
 * that issued them through CDP's loaderId, so request-after-navigation works
 * on real document identity. Events outside start()..stop() are ignored.
 */
export class CdpAssembler {
  readonly #tabId: number;
  readonly #now: () => number;
  readonly #pending = new Map<string, Pending>();
  /** Main frame is 0; iframes are numbered 1, 2, ... in the order they appear. */
  readonly #frameIndexes = new Map<string, number>();
  #childFrameCount = 0;
  readonly #requests: RawRequestObservation[] = [];
  readonly #navigations: RawNavigationObservation[] = [];
  #mainFrameId: string | null = null;
  #mainLoaderId: string | null = null;
  #capturing = false;
  #stopped = false;

  /** `now` supplies navigation timestamps; CDP navigation events carry none. */
  constructor(tabId: number, now: () => number) {
    this.#tabId = tabId;
    this.#now = now;
  }

  get capturing(): boolean {
    return this.#capturing;
  }

  /** Requests started but not yet finished. */
  get pendingCount(): number {
    return this.#pending.size;
  }

  start(): void {
    if (this.#capturing) {
      throw new Error('Capture is already running.');
    }
    if (this.#stopped) {
      throw new Error('This capture has already been stopped; create a new one.');
    }
    this.#capturing = true;
  }

  /**
   * Ends the capture. Requests still in flight are recorded with an unknown
   * status and duration, rather than dropped or guessed.
   */
  stop(): CapturedEvents {
    if (!this.#capturing) {
      throw new Error('Capture has not been started.');
    }
    for (const [requestId, pending] of this.#pending) {
      this.#requests.push(this.#observation(requestId, pending, null, null, null));
    }
    this.#pending.clear();
    this.#capturing = false;
    this.#stopped = true;
    return { requests: [...this.#requests], navigations: [...this.#navigations] };
  }

  #frameIndex(frameId: string | undefined): number | null {
    if (frameId === undefined) {
      return null;
    }
    return this.#frameIndexes.get(frameId) ?? null;
  }

  #observation(
    requestId: string,
    pending: Pending,
    endTimestamp: number | null,
    status: number | null,
    error: string | null,
  ): RawRequestObservation {
    const { start } = pending;
    const duration = endTimestamp === null ? null : (endTimestamp - start.timestamp) * 1_000;
    return {
      id: `cdp-${requestId.replace(/[^A-Za-z0-9._:-]/g, '_')}-${String(pending.hop)}`.slice(0, 128),
      timestamp: start.wallTime * 1_000,
      source: 'playwright',
      method: start.request.method,
      url: start.request.url,
      resourceType: start.type ?? null,
      status: status !== null && status >= 0 && status <= 999 ? status : null,
      error,
      durationMs: duration === null || duration < 0 ? null : Math.min(duration, 86_400_000),
      initiator: originOrNull(start.documentURL),
      context: {
        tabId: this.#tabId,
        frameId: this.#frameIndex(start.frameId),
        documentId: start.loaderId.length > 0 ? start.loaderId.slice(0, 128) : null,
      },
      body: bodyOf(start.request),
    };
  }

  onRequestWillBeSent(event: CdpRequestWillBeSent): void {
    if (!this.#capturing) {
      return;
    }
    const previous = this.#pending.get(event.requestId);
    let hop = 0;
    if (previous !== undefined && event.redirectResponse !== undefined) {
      // A redirect: the previous hop ends with the redirect status.
      this.#requests.push(
        this.#observation(
          event.requestId,
          previous,
          event.timestamp,
          event.redirectResponse.status,
          null,
        ),
      );
      hop = previous.hop + 1;
    }
    this.#pending.delete(event.requestId);
    if (isHttp(event.request.url)) {
      this.#pending.set(event.requestId, { start: event, hop, status: null });
    }
  }

  onResponseReceived(event: CdpResponseReceived): void {
    const pending = this.#pending.get(event.requestId);
    if (pending !== undefined) {
      pending.status = event.response.status;
    }
  }

  onLoadingFinished(event: CdpLoadingFinished): void {
    const pending = this.#pending.get(event.requestId);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(event.requestId);
    this.#requests.push(
      this.#observation(event.requestId, pending, event.timestamp, pending.status, null),
    );
  }

  onLoadingFailed(event: CdpLoadingFailed): void {
    const pending = this.#pending.get(event.requestId);
    if (pending === undefined) {
      return;
    }
    this.#pending.delete(event.requestId);
    this.#requests.push(
      this.#observation(
        event.requestId,
        pending,
        event.timestamp,
        null,
        event.errorText || 'net::ERR_FAILED',
      ),
    );
  }

  #recordNavigation(url: string, documentId: string): void {
    if (!this.#capturing) {
      return;
    }
    this.#navigations.push({
      id: `nav-${String(this.#tabId)}-${String(this.#navigations.length + 1)}`,
      timestamp: this.#now(),
      url,
      context: { tabId: this.#tabId, frameId: 0, documentId: documentId.slice(0, 128) },
    });
  }

  /** A new document in a frame. Only the main frame counts as a navigation. */
  onFrameNavigated(event: CdpFrameNavigated): void {
    const { frame } = event;
    if (frame.parentId === undefined) {
      this.#mainFrameId = frame.id;
      this.#frameIndexes.set(frame.id, 0);
      this.#mainLoaderId = frame.loaderId;
      this.#recordNavigation(frame.url, frame.loaderId);
    } else if (!this.#frameIndexes.has(frame.id)) {
      this.#childFrameCount++;
      this.#frameIndexes.set(frame.id, this.#childFrameCount);
    }
  }

  /** A history-API route change: same document, new URL. */
  onNavigatedWithinDocument(event: CdpNavigatedWithinDocument): void {
    if (event.frameId === this.#mainFrameId && this.#mainLoaderId !== null) {
      this.#recordNavigation(event.url, this.#mainLoaderId);
    }
  }
}
