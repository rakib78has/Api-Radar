import type { ResourceType } from '@api-qa/contracts';

/**
 * Resource-type names used by Chrome webRequest, the DevTools protocol and
 * Playwright. A Map, not an object literal, so names like `__proto__` cannot
 * resolve to inherited properties.
 */
const RESOURCE_TYPE_ALIASES: ReadonlyMap<string, ResourceType> = new Map<string, ResourceType>([
  ['xmlhttprequest', 'api'],
  ['xhr', 'api'],
  ['fetch', 'api'],
  ['eventsource', 'api'],
  ['main_frame', 'document'],
  ['sub_frame', 'document'],
  ['document', 'document'],
  ['script', 'script'],
  ['stylesheet', 'stylesheet'],
  ['image', 'image'],
  ['imageset', 'image'],
  ['font', 'font'],
  ['media', 'media'],
  ['websocket', 'websocket'],
  ['ping', 'beacon'],
  ['beacon', 'beacon'],
  ['csp_report', 'beacon'],
  ['cspviolationreport', 'beacon'],
]);

/** Unknown names become `other`; `null` (the source did not say) stays `null`. */
export function normalizeResourceType(raw: string | null): ResourceType | null {
  if (raw === null) {
    return null;
  }
  return RESOURCE_TYPE_ALIASES.get(raw.trim().toLowerCase()) ?? 'other';
}
