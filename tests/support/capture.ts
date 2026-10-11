import type { RawRequestObservation, RequestContext } from '@api-qa/contracts';

export const SHOP = 'https://shop.test';

type RawOverrides = Partial<Omit<RawRequestObservation, 'context'>> & {
  readonly context?: Partial<RequestContext>;
};

/** A raw observation as a capture adapter would produce it, before sanitisation. */
export function observation(
  id: string,
  timestamp: number,
  overrides: RawOverrides = {},
): RawRequestObservation {
  const { context, ...rest } = overrides;
  return {
    id,
    timestamp,
    source: 'playwright',
    method: 'GET',
    url: `${SHOP}/api/cart`,
    resourceType: 'fetch',
    status: 200,
    error: null,
    durationMs: 20,
    initiator: SHOP,
    body: { kind: 'absent' },
    ...rest,
    context: { tabId: 1, frameId: 0, documentId: 'doc-cart', ...context },
  };
}
