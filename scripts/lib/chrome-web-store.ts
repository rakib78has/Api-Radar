/**
 * Chrome Web Store API V2 client: upload a new package to an existing item and
 * submit it for review. V1/v1.1 reached end of support on 2026-10-15.
 * https://developer.chrome.com/docs/webstore/using-api
 */

export interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type Http = (
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: Uint8Array | string },
) => Promise<HttpResponse>;

export interface OAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly refreshToken: string;
}

export const PUBLISH_TYPES = ['STAGED_PUBLISH', 'DEFAULT_PUBLISH'] as const;
export type PublishType = (typeof PUBLISH_TYPES)[number];

export interface StoreItem {
  readonly publisherId: string;
  readonly extensionId: string;
  /** STAGED_PUBLISH: after review, wait for a manual publish. DEFAULT_PUBLISH: go live after review. */
  readonly publishType: PublishType;
}

export interface SubmitOptions {
  readonly sleep: (ms: number) => Promise<void>;
  /** Status checks while the store processes the upload. */
  readonly maxPolls?: number;
  readonly pollIntervalMs?: number;
}

export interface SubmitResult {
  readonly uploadState: string;
  readonly publishState: string;
}

export class StoreError extends Error {
  override name = 'StoreError';
}

const API = 'https://chromewebstore.googleapis.com';
const EXTENSION_ID = /^[a-p]{32}$/;
const PUBLISHER_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Google's docs use both spellings for an upload still being processed. */
const IN_PROGRESS = new Set(['IN_PROGRESS', 'UPLOAD_IN_PROGRESS']);

/** Validates the item settings, so nothing unexpected is interpolated into API URLs. */
export function storeItem(
  publisherId: string,
  extensionId: string,
  publishType = 'STAGED_PUBLISH',
): StoreItem {
  if (!PUBLISHER_ID.test(publisherId)) {
    throw new StoreError('CWS_PUBLISHER_ID is not a valid publisher id');
  }
  if (!EXTENSION_ID.test(extensionId)) {
    throw new StoreError('CWS_EXTENSION_ID must be a 32-character extension id (letters a-p)');
  }
  const type = PUBLISH_TYPES.find((candidate) => candidate === publishType);
  if (type === undefined) {
    throw new StoreError(`CWS_PUBLISH_TYPE must be one of ${PUBLISH_TYPES.join(', ')}`);
  }
  return { publisherId, extensionId, publishType: type };
}

async function jsonOf(response: HttpResponse, action: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!response.ok) {
    // The body is Google's error message; it never contains our credentials.
    throw new StoreError(
      `${action} failed with HTTP ${String(response.status)}: ${text.slice(0, 500)}`,
    );
  }
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value));
    }
  } catch {
    // fall through
  }
  throw new StoreError(`${action} returned an unexpected response`);
}

function field(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  return typeof value === 'string' ? value : '';
}

/** Exchanges an OAuth refresh token for a short-lived access token. */
export async function accessToken(http: Http, credentials: OAuthCredentials): Promise<string> {
  const form = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  });
  const body = await jsonOf(
    await http('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }),
    'Token exchange',
  );
  const token = field(body, 'access_token');
  if (token === '') {
    throw new StoreError('Token exchange returned no access token');
  }
  return token;
}

/**
 * Uploads the package, waits until the store has processed it, then submits
 * it for review with the configured publish type.
 */
export async function uploadAndSubmit(
  http: Http,
  token: string,
  item: StoreItem,
  zip: Uint8Array,
  options: SubmitOptions,
): Promise<SubmitResult> {
  const auth = { authorization: `Bearer ${token}` };
  const path = `publishers/${item.publisherId}/items/${item.extensionId}`;

  const uploaded = await jsonOf(
    await http(`${API}/upload/v2/${path}:upload`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/zip' },
      body: zip,
    }),
    'Upload',
  );
  let uploadState = field(uploaded, 'uploadState');

  const maxPolls = options.maxPolls ?? 30;
  for (let poll = 0; IN_PROGRESS.has(uploadState) && poll < maxPolls; poll++) {
    await options.sleep(options.pollIntervalMs ?? 5_000);
    const status = await jsonOf(
      await http(`${API}/v2/${path}:fetchStatus`, { method: 'GET', headers: auth }),
      'Status check',
    );
    uploadState =
      field(status, 'lastAsyncUploadState') || field(status, 'uploadState') || uploadState;
  }
  if (uploadState !== 'SUCCEEDED') {
    throw new StoreError(
      IN_PROGRESS.has(uploadState)
        ? 'The store is still processing the upload; check the Developer Dashboard'
        : `Upload was not accepted (state: ${uploadState || 'unknown'}). Is the manifest version higher than the published one?`,
    );
  }

  const published = await jsonOf(
    await http(`${API}/v2/${path}:publish`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ publishType: item.publishType }),
    }),
    'Submit for review',
  );
  return { uploadState, publishState: field(published, 'state') || 'unknown' };
}
