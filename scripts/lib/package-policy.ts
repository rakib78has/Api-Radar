/** File types a packaged extension may contain. */
const ALLOWED = /\.(html|js|css|json|png)$/;

/**
 * Checks the file list of a production extension build before it is zipped:
 * only expected file types, no source maps, no E2E build, no dotfiles, and
 * the files the extension needs to start.
 */
export function checkPackageFiles(files: readonly string[]): string[] {
  const issues: string[] = [];
  for (const file of files) {
    if (file.split('/').some((segment) => segment.startsWith('.'))) {
      issues.push(`${file}: hidden files must not be packaged`);
    } else if (file.endsWith('.map')) {
      issues.push(`${file}: source maps must not be packaged`);
    } else if (!ALLOWED.test(file)) {
      issues.push(`${file}: unexpected file type`);
    }
  }
  for (const required of [
    'manifest.json',
    'background.js',
    'popup/index.html',
    'panel/index.html',
  ]) {
    if (!files.includes(required)) {
      issues.push(`${required} is missing`);
    }
  }
  if (!files.some((file) => /^icons\/icon-128\.png$/.test(file))) {
    issues.push('icons/icon-128.png is missing (the Chrome Web Store requires it)');
  }
  return issues;
}

/** `sha256sum`-compatible lines: `<hex>  <name>`. */
export function checksumLines(entries: readonly { name: string; sha256: string }[]): string {
  return `${entries.map((entry) => `${entry.sha256}  ${entry.name}`).join('\n')}\n`;
}
