import { HTTP_METHODS, type CapturedRequest } from '@api-qa/contracts';
import { useState } from 'react';

import {
  ALL_REQUESTS,
  STATUS_CLASSES,
  filterRequests,
  optionOrAll,
  statusClassOf,
  type RequestFilter,
} from '../ui/filters.js';

/** Rows rendered at once; filtering narrows large sessions. */
const MAX_ROWS = 500;

export function RequestsView({ requests }: { readonly requests: readonly CapturedRequest[] }) {
  const [filter, setFilter] = useState<RequestFilter>(ALL_REQUESTS);
  const filtered = filterRequests(requests, filter);
  const firstTimestamp = requests[0]?.timestamp ?? 0;

  return (
    <section className="stack">
      <div className="row" role="search">
        <label>
          Method{' '}
          <select
            value={filter.method}
            onChange={(event) => {
              setFilter({ ...filter, method: optionOrAll(event.target.value, HTTP_METHODS) });
            }}
          >
            <option value="all">All</option>
            {HTTP_METHODS.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
        </label>
        <label>
          Status{' '}
          <select
            value={filter.status}
            onChange={(event) => {
              setFilter({ ...filter, status: optionOrAll(event.target.value, STATUS_CLASSES) });
            }}
          >
            <option value="all">All</option>
            {STATUS_CLASSES.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label>
          URL{' '}
          <input
            type="search"
            value={filter.text}
            placeholder="/api/"
            onChange={(event) => {
              setFilter({ ...filter, text: event.target.value });
            }}
          />
        </label>
        <span className="muted">
          {filtered.length > MAX_ROWS
            ? `Showing the first ${String(MAX_ROWS)} of ${String(filtered.length)}`
            : `${String(filtered.length)} of ${String(requests.length)}`}
        </span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>+ms</th>
              <th>Method</th>
              <th>Status</th>
              <th>URL</th>
              <th>Type</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, MAX_ROWS).map((request) => (
              <tr key={request.id}>
                <td className="num">{Math.round(request.timestamp - firstTimestamp)}</td>
                <td>{request.method}</td>
                <td className={statusClassOf(request) === 'error' ? 'error-text' : undefined}>
                  {request.error ?? request.status ?? '?'}
                </td>
                <td className="mono">{request.url}</td>
                <td>{request.resourceType ?? '?'}</td>
                <td className="num">
                  {request.durationMs === null
                    ? '?'
                    : `${String(Math.round(request.durationMs))} ms`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
