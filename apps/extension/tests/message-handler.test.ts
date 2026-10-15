import { MemoryStore, SessionRepository, SettingsRepository } from '@api-qa/storage';
import { describe, expect, it } from 'vitest';

import { CaptureController } from '../src/background/capture-controller.js';
import { handleMessage } from '../src/background/message-handler.js';
import { isTrustedSender, responseMessageSchema } from '../src/shared/messages.js';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}/`;

function setup(hasPermission = true) {
  const local = new MemoryStore();
  const sessions = new SessionRepository(local);
  const settings = new SettingsRepository(local);
  let clock = 1_000;
  const controller = new CaptureController({
    sessions,
    settings,
    state: new MemoryStore(),
    now: () => clock++,
    newId: () => 'fixed',
    hasHostPermission: () => Promise.resolve(hasPermission),
    schedule: () => undefined,
  });
  const send = async (message: unknown) => {
    const response = await handleMessage(message, { controller, sessions, settings });
    // Every response must satisfy the schema the UI validates against.
    return responseMessageSchema.parse(response);
  };
  return { send, sessions, settings };
}

/** The error text of a failed response; fails the test if the command succeeded. */
function errorText(response: Awaited<ReturnType<ReturnType<typeof setup>['send']>>): string {
  if (response.ok) {
    throw new Error('Expected the command to fail');
  }
  return [response.error, ...response.issues].join(' ');
}

const START = { type: 'capture/start', tabId: 3, origins: ['https://shop.test'], name: 'Run' };

describe('isTrustedSender', () => {
  it('accepts this extension’s own pages', () => {
    expect(
      isTrustedSender(
        { id: EXTENSION_ID, url: `${EXTENSION_ORIGIN}panel/index.html` },
        EXTENSION_ID,
        EXTENSION_ORIGIN,
      ),
    ).toBe(true);
  });

  it.each([
    ['another extension', { id: 'zzzz', url: `${EXTENSION_ORIGIN}x.html` }],
    ['a web page claiming the id', { id: EXTENSION_ID, url: 'https://evil.test/' }],
    ['a sender without a URL', { id: EXTENSION_ID }],
    ['an empty sender', {}],
    [
      'a look-alike origin',
      { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}.evil.test/` },
    ],
  ])('rejects %s', (_label, sender) => {
    expect(isTrustedSender(sender, EXTENSION_ID, EXTENSION_ORIGIN)).toBe(false);
  });
});

describe('handleMessage', () => {
  it.each([
    ['a non-object', 'capture/start'],
    ['an unknown type', { type: 'debug/eval', code: '1' }],
    ['extra fields', { type: 'capture/stop', force: true }],
    ['a page origin with a path', { ...START, origins: ['https://shop.test/path'] }],
    ['a javascript: origin', { ...START, origins: ['javascript:alert(1)'] }],
    ['no origins', { ...START, origins: [] }],
    ['a negative tab', { ...START, tabId: -1 }],
    ['a hostile session id', { type: 'session/delete', sessionId: '../../x' }],
  ])('refuses %s', async (_label, message) => {
    expect(await setup().send(message)).toEqual({
      ok: false,
      error: 'Unsupported or malformed command.',
      issues: [],
    });
  });

  it('starts, reports and stops a capture', async () => {
    const { send } = setup();
    expect(await send({ type: 'capture/status' })).toEqual({ ok: true, status: { active: false } });
    expect(await send(START)).toMatchObject({ ok: true, status: { active: true, tabId: 3 } });
    expect(errorText(await send(START))).toContain('already running');
    expect(await send({ type: 'capture/stop' })).toEqual({ ok: true, status: { active: false } });
  });

  it('turns a missing permission into an error response', async () => {
    expect(errorText(await setup(false).send(START))).toContain('Site access');
  });

  it('sets triage and protects the running session from deletion', async () => {
    const { send, sessions } = setup();
    await send(START);
    const sessionId = 'session-fixed';
    expect(
      await send({
        type: 'session/triage',
        sessionId,
        findingId: 'retry-loop:0123456789abcdef',
        status: 'confirmed',
      }),
    ).toMatchObject({ ok: true });
    expect(await send({ type: 'session/delete', sessionId })).toMatchObject({ ok: false });
    expect(await send({ type: 'sessions/clear' })).toMatchObject({ ok: false });
    await send({ type: 'capture/stop' });
    const loaded = await sessions.load(sessionId);
    expect(loaded.ok && loaded.value.triage).toEqual({
      'retry-loop:0123456789abcdef': 'confirmed',
    });
    expect(await send({ type: 'session/delete', sessionId })).toMatchObject({ ok: true });
    expect(await sessions.list()).toEqual([]);
  });

  it('clears all sessions when nothing is capturing', async () => {
    const { send, sessions } = setup();
    await send(START);
    await send({ type: 'capture/stop' });
    expect(await send({ type: 'sessions/clear' })).toMatchObject({ ok: true });
    expect(await sessions.list()).toEqual([]);
  });

  it('reports unexpected failures without throwing', async () => {
    const { send } = setup();
    const text = errorText(
      await send({
        type: 'session/triage',
        sessionId: 'missing',
        findingId: 'a',
        status: 'expected',
      }),
    );
    expect(text).toMatch(/^The command failed\. Session missing does not exist/);
  });

  it('validates and stores rule sets, and resets them', async () => {
    const { send, settings } = setup();
    const invalid = await send({ type: 'settings/save-rules', text: '{"schemaVersion":1}' });
    expect(invalid).toMatchObject({ ok: false, error: 'The rule set is not valid.' });
    expect(invalid.ok ? [] : invalid.issues.length).toBeGreaterThan(0);
    expect(
      await send({ type: 'settings/save-rules', text: '{"schemaVersion":1,"name":"Mine"}' }),
    ).toMatchObject({ ok: true });
    expect((await settings.getRuleSet()).ruleSet.name).toBe('Mine');
    expect(await send({ type: 'settings/reset-rules' })).toMatchObject({ ok: true });
    expect((await settings.getRuleSet()).ruleSet.name).toBe('Default');
  });
});
