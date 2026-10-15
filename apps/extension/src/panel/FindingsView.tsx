import {
  FINDING_TYPES,
  SEVERITIES,
  TRIAGE_STATUSES,
  type CapturedRequest,
  type Finding,
  type TriageStatus,
} from '@api-qa/contracts';
import { useMemo, useState } from 'react';

import {
  ALL_FINDINGS,
  filterFindings,
  groupFindingsByType,
  optionOrAll,
  triageOf,
  typeLabel,
  type FindingFilter,
} from '../ui/filters.js';

const TRIAGE_ACTIONS: readonly { status: TriageStatus; label: string }[] = [
  { status: 'confirmed', label: 'Confirm bug' },
  { status: 'expected', label: 'Expected' },
  { status: 'ignored', label: 'Ignore' },
  { status: 'open', label: 'Reopen' },
];

interface FindingsViewProps {
  readonly findings: readonly Finding[];
  readonly triage: Readonly<Record<string, TriageStatus>>;
  readonly requests: readonly CapturedRequest[];
  readonly onTriage: (findingId: string, status: TriageStatus) => void;
}

function FindingCard({
  finding,
  triage,
  requestsById,
  onTriage,
}: {
  readonly finding: Finding;
  readonly triage: TriageStatus;
  readonly requestsById: ReadonlyMap<string, CapturedRequest>;
  readonly onTriage: FindingsViewProps['onTriage'];
}) {
  const { evidence } = finding;
  return (
    <article className="card stack" aria-label={finding.title}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <span className={`badge sev-${finding.severity}`}>{finding.severity}</span>
          <strong>{finding.title}</strong>
        </div>
        <span className="muted">
          confidence {finding.confidence} · {triage}
        </span>
      </div>
      {finding.endpoint !== null && <p className="mono">{finding.endpoint}</p>}
      <p>{finding.reasoning}</p>
      <details>
        <summary>
          Evidence: {evidence.requestCount} request(s)
          {evidence.requestIds.length < evidence.requestCount
            ? ` (first ${String(evidence.requestIds.length)} listed)`
            : ''}
        </summary>
        <dl className="facts">
          {Object.entries(evidence.measurements).map(([name, value]) => (
            <div key={name} style={{ display: 'contents' }}>
              <dt>{name}</dt>
              <dd className="mono">{value === null ? 'n/a' : String(value)}</dd>
            </div>
          ))}
        </dl>
        {evidence.requestIds.length > 0 && (
          <ul className="mono">
            {evidence.requestIds.map((id) => {
              const request = requestsById.get(id);
              return (
                <li key={id}>
                  {request === undefined
                    ? id
                    : `${new Date(request.timestamp).toLocaleTimeString()} ${request.method} ${request.url} → ${
                        request.error ?? (request.status === null ? '?' : String(request.status))
                      }`}
                </li>
              );
            })}
          </ul>
        )}
      </details>
      <div className="row" role="group" aria-label="Triage">
        {TRIAGE_ACTIONS.filter((action) => action.status !== triage).map((action) => (
          <button
            key={action.status}
            type="button"
            onClick={() => {
              onTriage(finding.id, action.status);
            }}
          >
            {action.label}
          </button>
        ))}
      </div>
    </article>
  );
}

export function FindingsView({ findings, triage, requests, onTriage }: FindingsViewProps) {
  const [filter, setFilter] = useState<FindingFilter>(ALL_FINDINGS);
  const requestsById = useMemo(
    () => new Map(requests.map((request) => [request.id, request])),
    [requests],
  );
  const groups = groupFindingsByType(filterFindings(findings, triage, filter));

  return (
    <section className="stack">
      <div className="row" role="search">
        <label>
          Type{' '}
          <select
            value={filter.type}
            onChange={(event) => {
              setFilter({ ...filter, type: optionOrAll(event.target.value, FINDING_TYPES) });
            }}
          >
            <option value="all">All</option>
            {FINDING_TYPES.map((type) => (
              <option key={type} value={type}>
                {typeLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity{' '}
          <select
            value={filter.severity}
            onChange={(event) => {
              setFilter({ ...filter, severity: optionOrAll(event.target.value, SEVERITIES) });
            }}
          >
            <option value="all">All</option>
            {SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {severity}
              </option>
            ))}
          </select>
        </label>
        <label>
          Triage{' '}
          <select
            value={filter.triage}
            onChange={(event) => {
              setFilter({ ...filter, triage: optionOrAll(event.target.value, TRIAGE_STATUSES) });
            }}
          >
            <option value="all">All</option>
            {TRIAGE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Endpoint{' '}
          <input
            type="search"
            value={filter.text}
            placeholder="/api/orders"
            onChange={(event) => {
              setFilter({ ...filter, text: event.target.value });
            }}
          />
        </label>
      </div>

      {findings.length === 0 ? (
        <p className="notice">No findings: the captured traffic matches every rule.</p>
      ) : groups.length === 0 ? (
        <p className="muted">No findings match the filters.</p>
      ) : (
        groups.map((group) => (
          <section key={group.type} className="stack" aria-label={typeLabel(group.type)}>
            <h3>
              {typeLabel(group.type)} ({group.findings.length})
            </h3>
            {group.findings.map((finding) => (
              <FindingCard
                key={finding.id}
                finding={finding}
                triage={triageOf(finding, triage)}
                requestsById={requestsById}
                onTriage={onTriage}
              />
            ))}
          </section>
        ))
      )}
    </section>
  );
}
