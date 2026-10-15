import {
  FINDING_TYPES,
  type CapturedRequest,
  type Finding,
  type FindingType,
  type HttpMethod,
  type Severity,
  type TriageStatus,
} from '@api-qa/contracts';

export interface FindingFilter {
  readonly type: FindingType | 'all';
  readonly severity: Severity | 'all';
  readonly triage: TriageStatus | 'all';
  /** Case-insensitive text matched against the endpoint and title. */
  readonly text: string;
}

export const ALL_FINDINGS: FindingFilter = {
  type: 'all',
  severity: 'all',
  triage: 'all',
  text: '',
};

export function triageOf(
  finding: Finding,
  triage: Readonly<Record<string, TriageStatus>>,
): TriageStatus {
  return triage[finding.id] ?? 'open';
}

export function filterFindings(
  findings: readonly Finding[],
  triage: Readonly<Record<string, TriageStatus>>,
  filter: FindingFilter,
): Finding[] {
  const text = filter.text.trim().toLowerCase();
  return findings.filter(
    (finding) =>
      (filter.type === 'all' || finding.type === filter.type) &&
      (filter.severity === 'all' || finding.severity === filter.severity) &&
      (filter.triage === 'all' || triageOf(finding, triage) === filter.triage) &&
      (text === '' ||
        (finding.endpoint ?? '').toLowerCase().includes(text) ||
        finding.title.toLowerCase().includes(text)),
  );
}

export interface FindingGroup {
  readonly type: FindingType;
  readonly findings: readonly Finding[];
}

/** Groups findings by type in the canonical type order, keeping each group's order. */
export function groupFindingsByType(findings: readonly Finding[]): FindingGroup[] {
  return FINDING_TYPES.map((type) => ({
    type,
    findings: findings.filter((finding) => finding.type === type),
  })).filter((group) => group.findings.length > 0);
}

export const STATUS_CLASSES = ['2xx', '3xx', '4xx', '5xx', 'error', 'unknown'] as const;
export type StatusClass = (typeof STATUS_CLASSES)[number];

export function statusClassOf(request: CapturedRequest): StatusClass {
  if (request.error !== null) {
    return 'error';
  }
  const { status } = request;
  if (status === null || status < 200 || status >= 600) {
    return 'unknown';
  }
  if (status < 300) {
    return '2xx';
  }
  if (status < 400) {
    return '3xx';
  }
  return status < 500 ? '4xx' : '5xx';
}

export interface RequestFilter {
  readonly method: HttpMethod | 'all';
  readonly status: StatusClass | 'all';
  /** Case-insensitive text matched against the URL. */
  readonly text: string;
}

export const ALL_REQUESTS: RequestFilter = { method: 'all', status: 'all', text: '' };

export function filterRequests(
  requests: readonly CapturedRequest[],
  filter: RequestFilter,
): CapturedRequest[] {
  const text = filter.text.trim().toLowerCase();
  return requests.filter(
    (request) =>
      (filter.method === 'all' || request.method === filter.method) &&
      (filter.status === 'all' || statusClassOf(request) === filter.status) &&
      (text === '' || request.url.toLowerCase().includes(text)),
  );
}

/** Human label for a finding type, e.g. `duplicate-request` -> `Duplicate request`. */
export function typeLabel(type: FindingType): string {
  const words = type.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The option matching a <select> value, or 'all'. Avoids casting DOM strings. */
export function optionOrAll<T extends string>(value: string, options: readonly T[]): T | 'all' {
  return options.find((option) => option === value) ?? 'all';
}
