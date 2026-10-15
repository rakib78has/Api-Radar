import { parseRuleSet, type DetectionRuleSet } from '@api-qa/contracts';
import { useEffect, useState } from 'react';

import type { CaptureStatus } from '../shared/messages.js';
import { describeError } from '../shared/client.js';

interface RulesViewProps {
  readonly ruleSet: DetectionRuleSet;
  readonly onSave: (text: string) => Promise<CaptureStatus>;
  readonly onReset: () => Promise<CaptureStatus>;
}

/** Largest rule file accepted from disk. */
const MAX_FILE_BYTES = 1_048_576;

export function RulesView({ ruleSet, onSave, onReset }: RulesViewProps) {
  const [text, setText] = useState(() => JSON.stringify(ruleSet, null, 2));
  const [issues, setIssues] = useState<readonly string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(ruleSet, null, 2));
  }, [ruleSet]);

  const validate = (): boolean => {
    const parsed = parseRuleSet(text);
    setIssues(parsed.ok ? [] : parsed.issues);
    setMessage(parsed.ok ? 'The rule set is valid.' : null);
    return parsed.ok;
  };

  const save = async () => {
    if (!validate()) {
      return;
    }
    try {
      await onSave(text);
      setMessage('Saved. Every session is now analysed with these rules.');
    } catch (caught) {
      setMessage(null);
      setIssues([describeError(caught)]);
    }
  };

  const importFile = async (file: File | undefined) => {
    if (file === undefined) {
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setIssues([`The file is larger than ${String(MAX_FILE_BYTES)} bytes.`]);
      return;
    }
    setText(await file.text());
    setIssues([]);
    setMessage('Imported. Validate or save to apply it.');
  };

  return (
    <section className="stack">
      <p className="muted">
        Rules are JSON (schema version 1): duplicate window, retry and polling policies, required,
        forbidden and counted endpoints. See docs/detection-rules.md for every field.
      </p>
      <label className="stack">
        <span>Rule set</span>
        <textarea
          rows={24}
          spellCheck={false}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </label>
      <div className="row">
        <button type="button" onClick={() => validate()}>
          Validate
        </button>
        <button type="button" className="primary" onClick={() => void save()}>
          Save
        </button>
        <label className="row">
          <span>Import file</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void importFile(event.target.files?.[0])}
          />
        </label>
        <button
          type="button"
          className="danger"
          onClick={() =>
            void onReset().then(
              () => {
                setMessage('Reset to the default rules.');
              },
              (caught: unknown) => {
                setIssues([describeError(caught)]);
              },
            )
          }
        >
          Reset to defaults
        </button>
      </div>
      {message !== null && <p className="notice">{message}</p>}
      {issues.length > 0 && (
        <ul className="notice error" role="alert">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
