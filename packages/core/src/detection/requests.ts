import type { CapturedRequest, HttpMethod } from '@api-qa/contracts';

/** Time order, then id, so analysis never depends on input order. */
export function compareRequests(a: CapturedRequest, b: CapturedRequest): number {
  return a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** A network error or an HTTP status of 400 or above. An unknown status is not a failure. */
export function isFailure(request: CapturedRequest): boolean {
  return request.error !== null || (request.status !== null && request.status >= 400);
}

/** Methods whose repetition changes server state more than once. */
export function isNonIdempotent(method: HttpMethod): boolean {
  return method === 'POST' || method === 'PATCH' || method === 'CONNECT';
}

/** Methods that normally carry a body, so an unavailable body leaves equivalence uncertain. */
export function carriesBody(method: HttpMethod): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

/** Tab and document a request belongs to. Requests from different pages are never compared. */
export function contextKey(request: CapturedRequest): string {
  const { tabId, documentId } = request.context;
  return `${tabId === null ? '?' : String(tabId)}|${documentId ?? '?'}`;
}

/** Groups items by key, preserving input order inside each group and first-seen order of groups. */
export function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [item]);
    } else {
      group.push(item);
    }
  }
  return groups;
}

/** Gaps between consecutive timestamps of time-ordered requests. */
export function intervals(requests: readonly CapturedRequest[]): number[] {
  return requests.slice(1).map((request, index) => {
    const previous = requests[index];
    return previous === undefined ? 0 : request.timestamp - previous.timestamp;
  });
}

/** The single endpoint shared by all requests, or `null` if they differ. */
export function sharedEndpoint(requests: readonly CapturedRequest[]): string | null {
  const endpoints = new Set(requests.map((request) => request.fingerprint.endpoint));
  const [only] = endpoints;
  return endpoints.size === 1 && only !== undefined ? only : null;
}
