// Uploads a release zip to an existing Chrome Web Store item and submits it for review.
// Usage: node scripts/publish-chrome-web-store.ts <zip>
// Environment (set by the release workflow from repository secrets and variables):
//   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN   OAuth client and refresh token
//   CWS_PUBLISHER_ID, CWS_EXTENSION_ID                    the store item
//   CWS_PUBLISH_TYPE                                      STAGED_PUBLISH (default) or DEFAULT_PUBLISH
import { readFileSync } from 'node:fs';

import {
  StoreError,
  accessToken,
  storeItem,
  uploadAndSubmit,
  type Http,
} from './lib/chrome-web-store.ts';

const [zipPath] = process.argv.slice(2);
const env = (name: string): string => {
  const value = process.env[name] ?? '';
  if (value === '') {
    throw new StoreError(`${name} is not set`);
  }
  return value;
};

const http: Http = (url, init) => fetch(url, init);

try {
  if (zipPath === undefined) {
    throw new StoreError('Usage: node scripts/publish-chrome-web-store.ts <zip>');
  }
  // An unset repository variable reaches the job as an empty string, so treat both as "default".
  const publishType = process.env.CWS_PUBLISH_TYPE ?? '';
  const item = storeItem(
    env('CWS_PUBLISHER_ID'),
    env('CWS_EXTENSION_ID'),
    publishType === '' ? 'STAGED_PUBLISH' : publishType,
  );
  const token = await accessToken(http, {
    clientId: env('CWS_CLIENT_ID'),
    clientSecret: env('CWS_CLIENT_SECRET'),
    refreshToken: env('CWS_REFRESH_TOKEN'),
  });
  const result = await uploadAndSubmit(http, token, item, new Uint8Array(readFileSync(zipPath)), {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  process.stdout.write(
    `Uploaded ${zipPath} (${result.uploadState}) and submitted for review with ${item.publishType}: ${result.publishState}\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
