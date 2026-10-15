import type { CaptureSession } from '@api-qa/contracts';
import type { AnalysisResult } from '@api-qa/core';
import {
  buildReport,
  endpointsToCsv,
  findingsToCsv,
  reportFileName,
  reportToHtml,
  reportToJson,
} from '@api-qa/reporting';
import { useState } from 'react';

function download(fileName: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}

/** Exports the sanitised report; the request list itself is never exported. */
export function ExportBar({
  session,
  analysis,
}: {
  readonly session: CaptureSession;
  readonly analysis: AnalysisResult;
}) {
  const [error, setError] = useState<string | null>(null);

  const exportAs = (format: 'json' | 'csv' | 'endpoints-csv' | 'html') => {
    const result = buildReport({
      session,
      analysis,
      generatedAt: Date.now(),
      toolVersion: chrome.runtime.getManifest().version,
    });
    if (!result.ok) {
      setError(`Could not build the report: ${result.issues.join(' ')}`);
      return;
    }
    setError(null);
    const report = result.value;
    switch (format) {
      case 'json':
        download(reportFileName(report, 'json'), 'application/json', reportToJson(report));
        break;
      case 'csv':
        download(reportFileName(report, 'csv'), 'text/csv', findingsToCsv(report));
        break;
      case 'endpoints-csv':
        download(
          reportFileName(report, 'csv').replace('.csv', '-endpoints.csv'),
          'text/csv',
          endpointsToCsv(report),
        );
        break;
      case 'html':
        download(reportFileName(report, 'html'), 'text/html', reportToHtml(report));
        break;
    }
  };

  return (
    <div className="row" role="group" aria-label="Export report">
      <span className="muted">Export</span>
      <button
        type="button"
        onClick={() => {
          exportAs('html');
        }}
      >
        HTML
      </button>
      <button
        type="button"
        onClick={() => {
          exportAs('json');
        }}
      >
        JSON
      </button>
      <button
        type="button"
        onClick={() => {
          exportAs('csv');
        }}
      >
        Findings CSV
      </button>
      <button
        type="button"
        onClick={() => {
          exportAs('endpoints-csv');
        }}
      >
        Endpoints CSV
      </button>
      {error !== null && <span className="error-text">{error}</span>}
    </div>
  );
}
