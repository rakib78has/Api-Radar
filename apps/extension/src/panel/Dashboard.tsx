import type { CaptureSession, DetectionRuleSet, TriageStatus } from '@api-qa/contracts';
import { analyzeRequests } from '@api-qa/core';
import { SessionRepository, SettingsRepository, type SessionSummary } from '@api-qa/storage';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { chromeStore } from '../shared/chrome-store.js';
import { describeError, sendCommand } from '../shared/client.js';
import type { CaptureStatus } from '../shared/messages.js';
import { AboutView } from './AboutView.js';
import { ExportBar } from './ExportBar.js';
import { FindingsView } from './FindingsView.js';
import { RequestsView } from './RequestsView.js';
import { RulesView } from './RulesView.js';

// Pages only read storage; every write goes through the service worker.
const local = chromeStore(chrome.storage.local);
const sessions = new SessionRepository(local);
const settings = new SettingsRepository(local);

const TABS = ['findings', 'requests', 'rules', 'about'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Readonly<Record<Tab, string>> = {
  findings: 'Findings',
  requests: 'Requests',
  rules: 'Rules',
  about: 'Permissions & limits',
};

export function Dashboard({ initialSessionId }: { readonly initialSessionId: string | null }) {
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialSessionId);
  const [session, setSession] = useState<CaptureSession | null>(null);
  const [loadIssues, setLoadIssues] = useState<readonly string[]>([]);
  const [ruleSet, setRuleSet] = useState<DetectionRuleSet | null>(null);
  const [ruleIssues, setRuleIssues] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<CaptureStatus>({ active: false });
  const [tab, setTab] = useState<Tab>('findings');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await sessions.list();
    setSummaries(list);
    const stored = await settings.getRuleSet();
    setRuleSet(stored.ruleSet);
    setRuleIssues(stored.issues);
    const current = selectedId ?? list.at(-1)?.id ?? null;
    if (current !== selectedId) {
      setSelectedId(current);
    }
    if (current === null) {
      setSession(null);
      setLoadIssues([]);
      return;
    }
    const loaded = await sessions.load(current);
    setSession(loaded.ok ? loaded.value : null);
    setLoadIssues(loaded.ok ? [] : loaded.issues);
    try {
      setStatus(await sendCommand({ type: 'capture/status' }));
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [selectedId]);

  useEffect(() => {
    void reload();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onChanged = (_changes: unknown, area: string) => {
      if (area !== 'local') {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => void reload(), 300);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      clearTimeout(timer);
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, [reload]);

  const analysis = useMemo(
    () => (session === null || ruleSet === null ? null : analyzeRequests(session, ruleSet)),
    [session, ruleSet],
  );

  const run = async (action: () => Promise<CaptureStatus>) => {
    setError(null);
    try {
      setStatus(await action());
    } catch (caught) {
      setError(describeError(caught));
    }
  };

  const setTriage = (findingId: string, triage: TriageStatus) => {
    if (session !== null) {
      void run(() =>
        sendCommand({ type: 'session/triage', sessionId: session.id, findingId, status: triage }),
      );
    }
  };

  const deleteSession = () => {
    if (session !== null && confirm(`Delete session “${session.name}”? This cannot be undone.`)) {
      setSelectedId(null);
      void run(() => sendCommand({ type: 'session/delete', sessionId: session.id }));
    }
  };

  const clearAll = () => {
    if (confirm('Delete every captured session? This cannot be undone.')) {
      setSelectedId(null);
      void run(() => sendCommand({ type: 'sessions/clear' }));
    }
  };

  const capturingThis = status.active && session !== null && status.sessionId === session.id;

  return (
    <div className="dashboard">
      <aside className="sidebar">
        <h1>API QA Inspector</h1>
        <p className="muted">{summaries.length} saved session(s)</p>
        <ul aria-label="Sessions">
          {[...summaries].reverse().map((summary) => (
            <li key={summary.id}>
              <button
                type="button"
                aria-pressed={summary.id === selectedId}
                onClick={() => {
                  setSelectedId(summary.id);
                }}
              >
                <div>{summary.name}</div>
                <div className="muted">
                  {summary.requestCount} requests
                  {summary.endedAt === null ? ' · capturing' : ''}
                </div>
              </button>
            </li>
          ))}
        </ul>
        {summaries.length > 0 && (
          <p>
            <button type="button" className="danger" disabled={status.active} onClick={clearAll}>
              Clear all data
            </button>
          </p>
        )}
      </aside>

      <main className="content">
        {error !== null && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {ruleIssues.length > 0 && (
          <p className="notice error">
            The saved rule set is invalid, so the default rules are used: {ruleIssues.join(' ')}
          </p>
        )}
        {loadIssues.length > 0 && (
          <p className="notice error">This session could not be read: {loadIssues.join(' ')}</p>
        )}

        {session === null ? (
          <section className="stack">
            <h2>No session selected</h2>
            <p className="muted">
              Open the extension popup on a web page and press Start capture. Sessions appear here.
            </p>
          </section>
        ) : (
          <section className="stack">
            <header className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h2>{session.name}</h2>
                <p className="muted">
                  {session.requests.length} requests · {session.droppedRequestCount} dropped ·{' '}
                  {analysis?.findings.length ?? 0} findings · rules “{ruleSet?.name}”
                  {capturingThis ? ' · capturing (updates live)' : ''}
                </p>
              </div>
              <div className="row">
                {analysis !== null && <ExportBar session={session} analysis={analysis} />}
                <button
                  type="button"
                  className="danger"
                  disabled={capturingThis}
                  onClick={deleteSession}
                >
                  Delete session
                </button>
              </div>
            </header>
          </section>
        )}

        <nav className="tabs" role="tablist">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={tab === name}
              onClick={() => {
                setTab(name);
              }}
            >
              {TAB_LABELS[name]}
            </button>
          ))}
        </nav>

        {tab === 'findings' && session !== null && analysis !== null && (
          <FindingsView
            findings={analysis.findings}
            triage={session.triage}
            requests={session.requests}
            onTriage={setTriage}
          />
        )}
        {tab === 'requests' && session !== null && <RequestsView requests={session.requests} />}
        {tab === 'rules' && ruleSet !== null && (
          <RulesView
            ruleSet={ruleSet}
            onSave={(text) => sendCommand({ type: 'settings/save-rules', text })}
            onReset={() => sendCommand({ type: 'settings/reset-rules' })}
          />
        )}
        {tab === 'about' && <AboutView status={status} />}
      </main>
    </div>
  );
}
