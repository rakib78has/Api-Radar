const TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** `v1.2.3` -> `1.2.3`; anything else is rejected, so the tag is safe to use in paths and commands. */
export function versionFromTag(tag: string): string | null {
  const match = TAG.exec(tag);
  return match === null ? null : `${match[1] ?? ''}.${match[2] ?? ''}.${match[3] ?? ''}`;
}

/**
 * The body of a version's CHANGELOG section, or null if it is missing or
 * empty. Accepts both heading styles used in this changelog:
 * - Keep a Changelog: `## [1.2.0] - 2026-10-15`
 * - release-please:   `## [1.2.0](https://github.com/o/r/compare/v1.1.0...v1.2.0) (2026-10-15)`
 */
export function releaseNotes(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const escaped = version.replace(/\./g, '\\.');
  const heading = new RegExp(
    `^## \\[${escaped}\\](?: - \\d{4}-\\d{2}-\\d{2}|\\(https://[^\\s)]+\\) \\(\\d{4}-\\d{2}-\\d{2}\\))$`,
  );
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    return null;
  }
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  const body = lines
    .slice(start + 1, next === -1 ? undefined : next)
    .join('\n')
    .trim();
  return body.length > 0 ? body : null;
}

export interface ReleaseInputs {
  readonly tag: string;
  readonly extensionVersion: string;
  readonly rootVersion: string;
  readonly changelog: string;
}

export interface ReleaseCheck {
  readonly issues: readonly string[];
  readonly version: string | null;
  readonly notes: string | null;
}

/** Every condition a tag must meet before it is packaged. */
export function checkRelease(inputs: ReleaseInputs): ReleaseCheck {
  const issues: string[] = [];
  const version = versionFromTag(inputs.tag);
  if (version === null) {
    issues.push(`Tag "${inputs.tag}" is not of the form vMAJOR.MINOR.PATCH`);
    return { issues, version: null, notes: null };
  }
  if (inputs.extensionVersion !== version) {
    issues.push(`apps/extension/package.json is ${inputs.extensionVersion}, the tag is ${version}`);
  }
  if (inputs.rootVersion !== version) {
    issues.push(`package.json is ${inputs.rootVersion}, the tag is ${version}`);
  }
  const notes = releaseNotes(inputs.changelog, version);
  if (notes === null) {
    issues.push(`CHANGELOG.md has no non-empty section for ${version}`);
  }
  return { issues, version, notes };
}
