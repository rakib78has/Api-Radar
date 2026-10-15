import { LIMITS, type RawBody, type RawRequestObservation } from '@api-qa/contracts';

/** The webRequest fields the tracker reads; chrome's detail objects satisfy these. */
export interface RequestEventBase {
  readonly requestId: string;
  readonly url: string;
  readonly method: string;
  readonly tabId: number;
  readonly frameId: number;
  readonly type: string;
  readonly timeStamp: number;
  readonly initiator?: string | undefined;
  readonly documentId?: string | undefined;
}

export interface RequestBodyDetails {
  readonly error?: string | undefined;
  readonly formData?: Readonly<Record<string, readonly (string | ArrayBuffer)[]>> | undefined;
  readonly raw?:
    | readonly { readonly bytes?: ArrayBuffer | undefined; readonly file?: string | undefined }[]
    | undefined;
}

export interface BeforeRequestEvent extends RequestEventBase {
  readonly requestBody?: RequestBodyDetails | null | undefined;
}

export interface ResponseEvent extends RequestEventBase {
  readonly statusCode: number;
}

export interface ErrorEvent extends RequestEventBase {
  readonly error: string;
}

interface Pending {
  readonly start: BeforeRequestEvent;
  readonly hop: number;
}

/** In-flight requests kept at most; the oldest are forgotten first. */
export const MAX_PENDING = 5_000;

const BODYLESS_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const decoder = new TextDecoder('utf-8', { fatal: false });

function formDataToText(
  formData: Readonly<Record<string, readonly (string | ArrayBuffer)[]>>,
): string {
  const parts: string[] = [];
  for (const [name, values] of Object.entries(formData)) {
    for (const value of values) {
      const text = typeof value === 'string' ? value : decoder.decode(value);
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(text)}`);
    }
  }
  return parts.join('&');
}

/**
 * Converts webRequest's body representation. webRequest never reports the
 * Content-Type header without extra permissions, so form data is labelled as
 * urlencoded and raw bytes are left for the engine to sniff.
 */
export function bodyFrom(method: string, body: RequestBodyDetails | null | undefined): RawBody {
  if (body === undefined || body === null) {
    return BODYLESS_METHODS.has(method.toUpperCase())
      ? { kind: 'absent' }
      : { kind: 'unavailable' };
  }
  if (body.error !== undefined) {
    return { kind: 'unavailable' };
  }
  if (body.formData !== undefined) {
    return {
      kind: 'text',
      text: formDataToText(body.formData),
      contentType: 'application/x-www-form-urlencoded',
    };
  }
  const raw = body.raw ?? [];
  if (raw.length === 0) {
    return { kind: 'absent' };
  }
  if (raw.some((part) => part.file !== undefined || part.bytes === undefined)) {
    return { kind: 'unavailable' };
  }
  const total = raw.reduce((sum, part) => sum + (part.bytes?.byteLength ?? 0), 0);
  if (total > LIMITS.rawBodyLength) {
    return { kind: 'unavailable' };
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of raw) {
    if (part.bytes !== undefined) {
      bytes.set(new Uint8Array(part.bytes), offset);
      offset += part.bytes.byteLength;
    }
  }
  return { kind: 'text', text: decoder.decode(bytes), contentType: null };
}

/**
 * Joins webRequest events into raw observations. A request's start
 * (`onBeforeRequest`) carries the body; its end (`onCompleted`,
 * `onErrorOccurred`, or `onBeforeRedirect` for each redirect hop) carries the
 * outcome. If the service worker restarted mid-request the start is lost: the
 * observation is still produced, with the body and duration marked
 * unavailable rather than guessed.
 */
export class RequestTracker {
  readonly #pending = new Map<string, Pending>();
  readonly #hops = new Map<string, number>();

  begin(event: BeforeRequestEvent): void {
    if (this.#pending.size >= MAX_PENDING) {
      const oldest = this.#pending.keys().next().value;
      if (oldest !== undefined) {
        this.#pending.delete(oldest);
      }
    }
    this.#pending.set(event.requestId, { start: event, hop: this.#hops.get(event.requestId) ?? 0 });
  }

  /** A redirect ends one hop; the next `begin` with the same requestId starts the following hop. */
  redirect(event: ResponseEvent): RawRequestObservation {
    const observation = this.#finish(event, event.statusCode, null);
    this.#hops.set(event.requestId, (this.#hops.get(event.requestId) ?? 0) + 1);
    return observation;
  }

  complete(event: ResponseEvent): RawRequestObservation {
    const observation = this.#finish(event, event.statusCode, null);
    this.#hops.delete(event.requestId);
    return observation;
  }

  fail(event: ErrorEvent): RawRequestObservation {
    const observation = this.#finish(event, null, event.error);
    this.#hops.delete(event.requestId);
    return observation;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  #finish(
    event: RequestEventBase,
    status: number | null,
    error: string | null,
  ): RawRequestObservation {
    const pending = this.#pending.get(event.requestId);
    this.#pending.delete(event.requestId);
    const start = pending?.start;
    const hop = pending?.hop ?? this.#hops.get(event.requestId) ?? 0;
    const duration = start === undefined ? null : event.timeStamp - start.timeStamp;
    return {
      id: `wr-${event.requestId}-${String(hop)}`,
      timestamp: start?.timeStamp ?? event.timeStamp,
      source: 'extension-webrequest',
      method: (start ?? event).method,
      url: (start ?? event).url,
      resourceType: event.type,
      status: status !== null && status >= 0 && status <= 999 ? status : null,
      error,
      durationMs: duration === null || duration < 0 ? null : Math.min(duration, 86_400_000),
      initiator: event.initiator ?? null,
      context: {
        tabId: event.tabId >= 0 ? event.tabId : null,
        frameId: event.frameId >= 0 ? event.frameId : null,
        documentId: (start ?? event).documentId ?? null,
      },
      // Without the start event, a body-carrying method's body is unknown.
      body: bodyFrom((start ?? event).method, start?.requestBody),
    };
  }
}
