import {
  responseMessageSchema,
  type CaptureStatus,
  type RequestMessage,
  type ResponseMessage,
} from './messages.js';

export class CommandError extends Error {
  readonly issues: readonly string[];

  constructor(message: string, issues: readonly string[]) {
    super(message);
    this.name = 'CommandError';
    this.issues = issues;
  }
}

/**
 * Sends a command to the service worker and validates the reply. Throws
 * CommandError when the worker refuses the command.
 */
export async function sendCommand(message: RequestMessage): Promise<CaptureStatus> {
  const raw: unknown = await chrome.runtime.sendMessage(message);
  const parsed = responseMessageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CommandError('The extension background returned an unexpected reply.', []);
  }
  const response: ResponseMessage = parsed.data;
  if (!response.ok) {
    throw new CommandError(response.error, response.issues);
  }
  return response.status;
}

/** A readable message for any error a command can throw. */
export function describeError(error: unknown): string {
  if (error instanceof CommandError) {
    return [error.message, ...error.issues].join(' ');
  }
  return error instanceof Error ? error.message : String(error);
}
