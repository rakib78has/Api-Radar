/** Value written in place of a redacted query parameter or body field. */
export const REDACTED = '[REDACTED]';

/** Names that are sensitive only as a whole word, e.g. `key` but not `monkey`. */
const SENSITIVE_EXACT = new Set([
  'auth',
  'code',
  'csrf',
  'cvc',
  'cvv',
  'jwt',
  'key',
  'nonce',
  'otp',
  'pass',
  'pin',
  'pwd',
  'sid',
  'sig',
  'ssn',
  'xsrf',
]);

/** Names that are sensitive wherever they appear, e.g. `access_token`, `X-Amz-Signature`. */
const SENSITIVE_FRAGMENTS = [
  'accesskey',
  'apikey',
  'authorization',
  'cardnumber',
  'cookie',
  'credential',
  'creditcard',
  'passcode',
  'passwd',
  'password',
  'privatekey',
  'secret',
  'session',
  'signature',
  'token',
];

/** Lower-cases and drops separators, so `Access-Token`, `access_token` and `accessToken` compare equal. */
export function canonicalName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export type SensitiveNameMatcher = (name: string) => boolean;

/** Built-in sensitive names plus `extraNames` (compared after `canonicalName`). */
export function createSensitiveNameMatcher(extraNames: readonly string[]): SensitiveNameMatcher {
  const extra = new Set(extraNames.map(canonicalName).filter((name) => name.length > 0));
  return (name) => {
    const canonical = canonicalName(name);
    return (
      SENSITIVE_EXACT.has(canonical) ||
      extra.has(canonical) ||
      SENSITIVE_FRAGMENTS.some((fragment) => canonical.includes(fragment))
    );
  };
}

const URL_IN_TEXT = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/** Replaces URLs inside free text (error messages) so their queries cannot leak. */
export function redactUrlsInText(text: string): string {
  return text.replace(URL_IN_TEXT, '[URL]');
}
