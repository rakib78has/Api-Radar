import type { SessionRepository, SettingsRepository } from '@api-qa/storage';

import { requestMessageSchema, type ResponseMessage } from '../shared/messages.js';
import { CaptureError, type CaptureController } from './capture-controller.js';

export interface HandlerDependencies {
  readonly controller: CaptureController;
  readonly sessions: SessionRepository;
  readonly settings: SettingsRepository;
}

function failure(error: string, issues: readonly string[] = []): ResponseMessage {
  return { ok: false, error, issues: issues.slice(0, 50) };
}

/**
 * Validates and executes one command from a trusted extension page. Unknown
 * or malformed messages are refused; errors become responses, never throws.
 */
export async function handleMessage(
  message: unknown,
  { controller, sessions, settings }: HandlerDependencies,
): Promise<ResponseMessage> {
  const parsed = requestMessageSchema.safeParse(message);
  if (!parsed.success) {
    return failure('Unsupported or malformed command.');
  }
  const command = parsed.data;
  try {
    switch (command.type) {
      case 'capture/status':
        return { ok: true, status: await controller.status() };
      case 'capture/start':
        return {
          ok: true,
          status: await controller.start({
            tabId: command.tabId,
            origins: command.origins,
            name: command.name,
          }),
        };
      case 'capture/stop':
        return { ok: true, status: await controller.stop() };
      case 'session/triage':
        await controller.exclusive(() =>
          sessions.setTriage(command.sessionId, command.findingId, command.status),
        );
        break;
      case 'session/delete':
        if (controller.activeSessionId === command.sessionId) {
          return failure('Stop the capture before deleting its session.');
        }
        await controller.exclusive(() => sessions.delete(command.sessionId));
        break;
      case 'sessions/clear':
        if (controller.activeSessionId !== null) {
          return failure('Stop the capture before clearing data.');
        }
        await controller.exclusive(() => sessions.clear());
        break;
      case 'settings/save-rules': {
        const saved = await settings.saveRuleSet(command.text);
        if (!saved.ok) {
          return failure('The rule set is not valid.', saved.issues);
        }
        controller.reloadRules();
        break;
      }
      case 'settings/reset-rules':
        await settings.resetRuleSet();
        controller.reloadRules();
        break;
    }
    return { ok: true, status: await controller.status() };
  } catch (error) {
    if (error instanceof CaptureError) {
      return failure(error.message);
    }
    return failure('The command failed.', [error instanceof Error ? error.message : String(error)]);
  }
}
