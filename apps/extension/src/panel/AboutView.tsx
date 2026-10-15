import { useEffect, useState } from 'react';

import type { CaptureStatus } from '../shared/messages.js';

const LIMITATIONS = [
  'Requests are observed with chrome.webRequest. Response bodies are never available, and request bodies only for form and raw uploads.',
  'Content-Type headers are not read, so raw bodies are recognised as JSON by their content only.',
  'Durations are measured between webRequest events and include queueing; they are approximate.',
  'XHR and fetch cannot be told apart; both are reported as "api".',
  'Only the captured tab and the origins you granted are observed. Requests from service workers and other tabs are not captured.',
  'If the browser restarts, a running capture ends; the session up to that point is kept.',
  'Single-page-app route changes do not count as navigations.',
];

export function AboutView({ status }: { readonly status: CaptureStatus }) {
  const [origins, setOrigins] = useState<readonly string[]>([]);

  const refresh = () => {
    void chrome.permissions.getAll().then((all) => {
      setOrigins(all.origins ?? []);
    });
  };
  useEffect(refresh, []);

  const revoke = (origin: string) => {
    void chrome.permissions.remove({ origins: [origin] }).then(refresh);
  };

  return (
    <section className="stack">
      <h2>Site access</h2>
      {origins.length === 0 ? (
        <p className="muted">
          No site access granted. The popup asks for it when you start a capture.
        </p>
      ) : (
        <ul>
          {origins.map((origin) => (
            <li key={origin} className="row">
              <span className="mono">{origin}</span>
              <button
                type="button"
                disabled={status.active}
                onClick={() => {
                  revoke(origin);
                }}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      <h2>Privacy</h2>
      <p>
        Everything stays in this browser profile. Before anything is stored, credentials and URL
        fragments are removed, sensitive query values are replaced with [REDACTED], token-like path
        segments become :token, and request bodies are reduced to a fingerprint. Headers and cookies
        are never read. Old sessions are deleted automatically (20 sessions or 30 days by default).
      </p>

      <h2>Capture limitations</h2>
      <ul>
        {LIMITATIONS.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </section>
  );
}
