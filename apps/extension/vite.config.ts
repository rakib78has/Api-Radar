import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

import { E2E_HOST_PERMISSIONS } from './scripts/build-options.ts';

const fromHere = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

function readJson(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(fromHere(path), 'utf8'));
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return Object.fromEntries(Object.entries(value));
}

/** Emits manifest.json with the package version (and, for E2E builds, the test host). */
function manifestPlugin(e2e: boolean): Plugin {
  return {
    name: 'api-qa-manifest',
    generateBundle() {
      const manifest = readJson('manifest.json');
      manifest.version = readJson('package.json').version;
      if (e2e) {
        manifest.host_permissions = E2E_HOST_PERMISSIONS;
      }
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify(manifest, null, 2)}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const e2e = mode === 'e2e';
  return {
    root: fromHere('src'),
    base: './',
    publicDir: false,
    plugins: [manifestPlugin(e2e)],
    oxc: { jsx: { runtime: 'automatic' } },
    build: {
      outDir: fromHere(e2e ? 'dist-e2e' : 'dist'),
      emptyOutDir: true,
      target: 'chrome116',
      // Chrome supports modulepreload natively; the polyfill would add inline code.
      modulePreload: { polyfill: false },
      sourcemap: false,
      rolldownOptions: {
        input: {
          popup: fromHere('src/popup/index.html'),
          dashboard: fromHere('src/panel/index.html'),
          background: fromHere('src/background/service-worker.ts'),
        },
        output: {
          entryFileNames: (chunk) =>
            chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js',
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
