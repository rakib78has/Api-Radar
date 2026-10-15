import { useCallback, useEffect, useState } from 'react';

import { describeError, sendCommand } from '../shared/client.js';
import type { CaptureStatus } from '../shared/messages.js';
import { httpOrigin, matchPatternFor, parseOriginList } from '../shared/origins.js';

interface ActiveTab {
  readonly id: number;
  readonly origin: string | null;
  readonly title: string;
}

async function queryActiveTab(): Promise<ActiveTab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    return null;
  }
  return { id: tab.id, origin: httpOrigin(tab.url), title: tab.title ?? '' };
}

function openDashboard(sessionId?: string): void {
  const query = sessionId === undefined ? '' : `?session=${encodeURIComponent(sessionId)}`;
  void chrome.tabs.create({ url: chrome.runtime.getURL(`panel/index.html${query}`) });
}

export function Popup() {
  const [tab, setTab] = useState<ActiveTab | null>(null);
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [extraOrigins, setExtraOrigins] = useState('');
  const [granted, setGranted] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const extra = parseOriginList(extraOrigins);
  const origins =
    tab?.origin === null || tab?.origin === undefined
      ? []
      : [...new Set([tab.origin, ...extra.origins])];

  const refresh = useCallback(async () => {
    try {
      setTab(await queryActiveTab());
      setStatus(await sendCommand({ type: 'capture/status' }));
    } catch (caught) {
      setError(describeError(caught));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const originKey = origins.join(' ');
  useEffect(() => {
    if (originKey === '') {
      setGranted(null);
      return;
    }
    void chrome.permissions
      .contains({ origins: originKey.split(' ').map(matchPatternFor) })
      .then(setGranted);
  }, [originKey]);

  const start = async () => {
    if (tab === null || origins.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Must run in the click handler: Chrome only shows the prompt on a user gesture.
      // If the popup closes while the prompt is open, reopen it and press Start again.
      const allowed = await chrome.permissions.request({ origins: origins.map(matchPatternFor) });
      setGranted(allowed);
      if (!allowed) {
        setError('Site access was not granted, so nothing can be captured.');
        return;
      }
      const name = `${new URL(origins[0] ?? '').host} ${new Date().toLocaleString()}`;
      setStatus(await sendCommand({ type: 'capture/start', tabId: tab.id, origins, name }));
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    setError(null);
    try {
      const sessionId = status?.active === true ? status.sessionId : undefined;
      setStatus(await sendCommand({ type: 'capture/stop' }));
      openDashboard(sessionId);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  };

  const capturingHere = status?.active === true && status.tabId === tab?.id;

  return (
    <main className="popup stack">
      <header className="row" style={{ justifyContent: 'space-between' }}>
        <h1>API QA Inspector</h1>
        <button
          type="button"
          onClick={() => {
            openDashboard();
          }}
        >
          Dashboard
        </button>
      </header>

      {status?.active === true ? (
        <section className="card stack" aria-live="polite">
          <p>
            <strong className="ok">Capturing</strong>{' '}
            {capturingHere ? 'this tab' : `tab ${String(status.tabId)}`}
          </p>
          <p className="mono">{status.origins.join(', ')}</p>
          <p>
            {status.requestCount} requests recorded, {status.droppedRequestCount} dropped
          </p>
          <div className="row">
            <button type="button" className="primary" disabled={busy} onClick={() => void stop()}>
              Stop and analyse
            </button>
            <button type="button" disabled={busy} onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
        </section>
      ) : tab?.origin === null || tab === null ? (
        <p className="notice">Open an http or https page to capture its API requests.</p>
      ) : (
        <section className="stack">
          <div>
            <p className="muted">Capture requests from this tab to</p>
            <p className="mono">{tab.origin}</p>
          </div>
          <label className="stack">
            <span>Other API origins (optional, one per line)</span>
            <textarea
              rows={2}
              value={extraOrigins}
              placeholder="https://api.example.com"
              onChange={(event) => {
                setExtraOrigins(event.target.value);
              }}
            />
          </label>
          {extra.invalid.length > 0 && (
            <p className="error-text">Not an http(s) origin: {extra.invalid.join(', ')}</p>
          )}
          <p className="muted">
            Site access:{' '}
            {granted === null ? 'checking…' : granted ? 'granted' : 'will be requested'}
          </p>
          <button
            type="button"
            className="primary"
            disabled={busy || extra.invalid.length > 0}
            onClick={() => void start()}
          >
            Start capture
          </button>
        </section>
      )}

      {error !== null && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}

      <p className="muted">
        Only this tab and the listed origins are captured. Request bodies are fingerprinted, never
        stored; headers and cookies are never read. Data stays on this device.
      </p>
    </main>
  );
}
