import {
  LIMITS,
  countSchema,
  identifierSchema,
  nameSchema,
  timestampSchema,
  triageStatusSchema,
} from '@api-qa/contracts';
import { z } from 'zod';

import { isHttpOrigin } from './origins.js';

export const originSchema = z
  .string()
  .max(2_048)
  .refine(isHttpOrigin, 'Expected an http(s) origin such as https://shop.test');

const tabIdSchema = z.number().int().nonnegative();
const originsSchema = z.array(originSchema).min(1).max(20);

/** Every request the popup or dashboard may send to the service worker. */
export const requestMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('capture/status') }),
  z.strictObject({
    type: z.literal('capture/start'),
    tabId: tabIdSchema,
    origins: originsSchema,
    name: nameSchema,
  }),
  z.strictObject({ type: z.literal('capture/stop') }),
  z.strictObject({
    type: z.literal('session/triage'),
    sessionId: identifierSchema,
    findingId: identifierSchema,
    status: triageStatusSchema,
  }),
  z.strictObject({ type: z.literal('session/delete'), sessionId: identifierSchema }),
  z.strictObject({ type: z.literal('sessions/clear') }),
  z.strictObject({
    type: z.literal('settings/save-rules'),
    text: z.string().max(LIMITS.jsonDocumentLength),
  }),
  z.strictObject({ type: z.literal('settings/reset-rules') }),
]);
export type RequestMessage = z.infer<typeof requestMessageSchema>;

export const captureStateSchema = z.discriminatedUnion('active', [
  z.strictObject({ active: z.literal(false) }),
  z.strictObject({
    active: z.literal(true),
    sessionId: identifierSchema,
    tabId: tabIdSchema,
    origins: originsSchema,
    startedAt: timestampSchema,
  }),
]);
/** Persisted in chrome.storage.session so a restarted service worker resumes capturing. */
export type CaptureState = z.infer<typeof captureStateSchema>;

export const captureStatusSchema = z.discriminatedUnion('active', [
  z.strictObject({ active: z.literal(false) }),
  z.strictObject({
    active: z.literal(true),
    sessionId: identifierSchema,
    tabId: tabIdSchema,
    origins: originsSchema,
    startedAt: timestampSchema,
    requestCount: countSchema,
    droppedRequestCount: countSchema,
  }),
]);
export type CaptureStatus = z.infer<typeof captureStatusSchema>;

/** Every response carries the current capture status, or an error. */
export const responseMessageSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), status: captureStatusSchema }),
  z.strictObject({
    ok: z.literal(false),
    error: z.string().max(LIMITS.textLength),
    issues: z.array(z.string().max(LIMITS.textLength)).max(50),
  }),
]);
export type ResponseMessage = z.infer<typeof responseMessageSchema>;

export interface MessageSenderLike {
  readonly id?: string | undefined;
  readonly url?: string | undefined;
}

/**
 * Only this extension's own pages may send commands. Web pages cannot reach
 * the worker (no `externally_connectable`, no content scripts), but the check
 * makes that explicit and also rejects other extensions.
 */
export function isTrustedSender(
  sender: MessageSenderLike,
  extensionId: string,
  extensionOrigin: string,
): boolean {
  return (
    sender.id === extensionId &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(extensionOrigin)
  );
}
