import type {
  CapturedRequest,
  DetectionRuleSet,
  Finding,
  NavigationEvent,
} from '@api-qa/contracts';

import { buildFinding, evidenceFrom, formatMs } from './findings.js';
import { groupBy } from './requests.js';

function compareNavigations(a: NavigationEvent, b: NavigationEvent): number {
  return a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

interface TabHistory {
  /** Top-level navigations in time order. */
  readonly navigations: readonly NavigationEvent[];
  /** Indexes into `navigations`, per document id, ascending. */
  readonly indexesByDocument: ReadonlyMap<string, readonly number[]>;
}

function tabHistory(navigations: readonly NavigationEvent[]): TabHistory {
  const indexesByDocument = new Map<string, number[]>();
  navigations.forEach((navigation, index) => {
    const documentId = navigation.context.documentId ?? '';
    const indexes = indexesByDocument.get(documentId);
    if (indexes === undefined) {
      indexesByDocument.set(documentId, [index]);
    } else {
      indexes.push(index);
    }
  });
  return { navigations, indexesByDocument };
}

/**
 * The navigation that replaced the document which sent `request`, or `null`
 * if that document was still current (or its navigation was never seen).
 */
function replacementOf(request: CapturedRequest, history: TabHistory): NavigationEvent | null {
  const documentId = request.context.documentId ?? '';
  const ownIndex = (history.indexesByDocument.get(documentId) ?? [])
    .filter((index) => (history.navigations[index]?.timestamp ?? Infinity) <= request.timestamp)
    .at(-1);
  if (ownIndex === undefined) {
    return null;
  }
  return (
    history.navigations
      .slice(ownIndex + 1)
      .find((navigation) => navigation.context.documentId !== documentId) ?? null
  );
}

/**
 * Requests sent by a document after a newer top-level document replaced it in
 * the same tab, e.g. polling or timers that survived a navigation. Requests
 * without a known tab and document cannot be attributed and are skipped.
 * Same-document (history API) navigations are not document replacements.
 */
export function detectRequestsAfterNavigation(
  requests: readonly CapturedRequest[],
  navigations: readonly NavigationEvent[],
  config: DetectionRuleSet['navigation'],
): Finding[] {
  if (!config.enabled) {
    return [];
  }
  const topLevel = navigations
    .filter(
      (navigation) =>
        navigation.context.tabId !== null &&
        navigation.context.documentId !== null &&
        (navigation.context.frameId === null || navigation.context.frameId === 0),
    )
    .sort(compareNavigations);
  const histories = new Map(
    [...groupBy(topLevel, (navigation) => String(navigation.context.tabId))].map(
      ([tabId, tabNavigations]) => [tabId, tabHistory(tabNavigations)] as const,
    ),
  );

  const late: { request: CapturedRequest; replacement: NavigationEvent }[] = [];
  for (const request of requests) {
    const { tabId, documentId } = request.context;
    const history = histories.get(String(tabId));
    if (tabId === null || documentId === null || history === undefined) {
      continue;
    }
    const replacement = replacementOf(request, history);
    if (replacement !== null && request.timestamp > replacement.timestamp + config.graceMs) {
      late.push({ request, replacement });
    }
  }

  const groups = groupBy(
    late,
    ({ request }) =>
      `${String(request.context.tabId)}|${request.context.documentId ?? '?'}|${request.fingerprint.endpoint}`,
  );
  const findings: Finding[] = [];
  for (const [groupKey, group] of groups) {
    const first = group[0];
    if (first === undefined) {
      continue;
    }
    const lateRequests = group.map(({ request }) => request);
    const delay = first.request.timestamp - first.replacement.timestamp;
    findings.push(
      buildFinding({
        type: 'request-after-navigation',
        ruleId: 'request-after-navigation',
        identity: `${groupKey}|${first.request.id}`,
        severity: 'medium',
        confidence: 'high',
        title: `${first.request.method} request sent by a page the user had left`,
        reasoning:
          `${String(lateRequests.length)} request(s) came from a document that was replaced by a navigation ` +
          `${formatMs(delay)} earlier (grace period ${formatMs(config.graceMs)}). Timers, polling or ` +
          'retries probably outlived the page.',
        endpoint: first.request.fingerprint.endpoint,
        evidence: evidenceFrom(lateRequests, {
          navigatedAt: first.replacement.timestamp,
          navigatedTo: first.replacement.url,
          firstDelayAfterNavigationMs: delay,
          graceMs: config.graceMs,
        }),
      }),
    );
  }
  return findings;
}
