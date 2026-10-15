/** A credential-shaped string found in a file. */
export interface SecretFinding {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  /** The match with its middle masked, so logs never contain the secret. */
  readonly preview: string;
}

interface Rule {
  readonly id: string;
  readonly pattern: RegExp;
  /** Index of the capture group holding the secret value, or 0 for the whole match. */
  readonly group?: number;
  /** Only report when the value looks random (generic rules). */
  readonly requireEntropy?: boolean;
}

/** Well-known token formats: reported whenever they appear. */
const RULES: readonly Rule[] = [
  { id: 'aws-access-key-id', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: 'github-fine-grained-token', pattern: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { id: 'gitlab-token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'stripe-live-key', pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g },
  { id: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'npm-token', pattern: /\bnpm_[A-Za-z0-9]{36}\b/g },
  {
    id: 'private-key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    id: 'json-web-token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{16,}\b/g,
  },
  {
    // password = "…", apiKey: '…', etc. Only random-looking values are reported.
    id: 'generic-credential-assignment',
    pattern:
      /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b["']?\s*[:=]\s*["']([^"'\s]{16,})["']/gi,
    group: 1,
    requireEntropy: true,
  },
];

/** Words that mark a value as an obvious placeholder or test fixture. */
const PLACEHOLDER =
  /canary|example|placeholder|dummy|fake|redacted|changeme|your[_-]|xxxx|secret|test/i;

/** Shannon entropy in bits per character. */
export function entropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

export function mask(value: string): string {
  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 8, 24))}${value.slice(-4)}`;
}

/** Scans one file's text. Lines containing `secret-scan: allow` are skipped. */
export function scanText(file: string, text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  text.split(/\r?\n/).forEach((lineText, index) => {
    if (lineText.includes('secret-scan: allow')) {
      return;
    }
    for (const rule of RULES) {
      for (const match of lineText.matchAll(rule.pattern)) {
        const value = match[rule.group ?? 0] ?? match[0];
        if (rule.requireEntropy === true && (entropy(value) < 3.5 || PLACEHOLDER.test(value))) {
          continue;
        }
        findings.push({ file, line: index + 1, rule: rule.id, preview: mask(value) });
      }
    }
  });
  return findings;
}

/** Files that are never scanned: binaries and generated lockfiles. */
export function isScannable(path: string): boolean {
  return (
    !/\.(png|jpe?g|gif|ico|zip|crx|woff2?|ttf|pdf)$/i.test(path) && !path.endsWith('pnpm-lock.yaml')
  );
}
