import type { CapturedRequest, EndpointStats } from '@api-qa/contracts';

import { groupBy, isFailure } from '../detection/requests.js';

/** Nearest-rank percentile of `values` (0 < p <= 1); `null` for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1] ?? null;
}

/** Request, failure and timing statistics per endpoint, sorted by endpoint. */
export function computeEndpointStats(requests: readonly CapturedRequest[]): EndpointStats[] {
  return [...groupBy(requests, (request) => request.fingerprint.endpoint)]
    .map(([endpoint, group]) => {
      const durations = group
        .map((request) => request.durationMs)
        .filter((duration): duration is number => duration !== null);
      return {
        endpoint,
        requestCount: group.length,
        failureCount: group.filter(isFailure).length,
        timedRequestCount: durations.length,
        durationP50Ms: percentile(durations, 0.5),
        durationP95Ms: percentile(durations, 0.95),
      };
    })
    .sort((a, b) => (a.endpoint < b.endpoint ? -1 : a.endpoint > b.endpoint ? 1 : 0));
}
