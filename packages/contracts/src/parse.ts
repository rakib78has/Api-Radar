import type { z } from 'zod';

import { baselineSchema, type Baseline } from './baseline.js';
import { LIMITS } from './common.js';
import { sanitizedReportSchema, type SanitizedReport } from './report.js';
import { detectionRuleSetSchema, type DetectionRuleSet } from './rules.js';
import { captureSessionSchema, type CaptureSession } from './session.js';

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly string[] };

/** Most issues reported for one document; enough to fix it, short enough to display. */
const MAX_ISSUES = 20;

function formatPath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? '(root)' : path.map((part) => String(part)).join('.');
}

/** Validates untrusted input. Issues name the failing path and rule, never the offending value. */
export function parseWith<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): ParseResult<z.output<Schema>> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  const issues = result.error.issues
    .slice(0, MAX_ISSUES)
    .map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
  return { ok: false, issues };
}

/**
 * Parses JSON text from an untrusted file. The engine's syntax error is not
 * passed on because it can quote file content.
 */
export function parseJsonDocument(text: string): ParseResult<unknown> {
  if (text.length > LIMITS.jsonDocumentLength) {
    return {
      ok: false,
      issues: [`(root): Document exceeds ${String(LIMITS.jsonDocumentLength)} characters`],
    };
  }
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false, issues: ['(root): Not valid JSON'] };
  }
}

function parseDocument<Schema extends z.ZodType>(
  schema: Schema,
  input: unknown,
): ParseResult<z.output<Schema>> {
  if (typeof input === 'string') {
    const json = parseJsonDocument(input);
    return json.ok ? parseWith(schema, json.value) : json;
  }
  return parseWith(schema, input);
}

/** Accepts a parsed JSON value or the JSON text itself. */
export const parseRuleSet = (input: unknown): ParseResult<DetectionRuleSet> =>
  parseDocument(detectionRuleSetSchema, input);

export const parseBaseline = (input: unknown): ParseResult<Baseline> =>
  parseDocument(baselineSchema, input);

export const parseCaptureSession = (input: unknown): ParseResult<CaptureSession> =>
  parseDocument(captureSessionSchema, input);

export const parseSanitizedReport = (input: unknown): ParseResult<SanitizedReport> =>
  parseDocument(sanitizedReportSchema, input);
