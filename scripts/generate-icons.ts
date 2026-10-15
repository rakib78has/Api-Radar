// Generates the extension icons. `--check` fails if the committed files are out of date.
// Usage: node scripts/generate-icons.ts [--check]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { ICON_SIZES, renderIcon } from './lib/icon.ts';
import { encodePng } from './lib/png.ts';

const DIRECTORY = 'apps/extension/public/icons';
const check = process.argv.includes('--check');
const stale: string[] = [];

mkdirSync(DIRECTORY, { recursive: true });
for (const size of ICON_SIZES) {
  const path = `${DIRECTORY}/icon-${String(size)}.png`;
  const png = encodePng(size, size, renderIcon(size));
  if (check) {
    if (!existsSync(path) || !Buffer.from(png).equals(readFileSync(path))) {
      stale.push(path);
    }
  } else {
    writeFileSync(path, png);
    process.stdout.write(`${path} (${String(png.length)} bytes)\n`);
  }
}

if (stale.length > 0) {
  process.stderr.write(`Icons are out of date; run pnpm icons:\n  ${stale.join('\n  ')}\n`);
  process.exit(1);
}
if (check) {
  process.stdout.write('Icons are up to date.\n');
}
