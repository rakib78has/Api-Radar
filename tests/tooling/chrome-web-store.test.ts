import { describe, expect, it } from 'vitest';

import {
  StoreError,
  accessToken,
  storeItem,
  uploadAndSubmit,
  type Http,
} from '../../scripts/lib/chrome-web-store.ts';

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: Uint8Array | string;
}

/** A fake HTTP layer that answers each call from a queue and records it. */
function fakeHttp(responses: readonly (readonly [number, unknown])[]): {
  http: Http;
  calls: Call[];
} {
  const calls: Call[] = [];
  let index = 0;
  const http: Http = (url, init) => {
    calls.push({ url, ...init });
    const [status, body] = responses[index++] ?? [500, { error: 'no more responses' }];
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    });
  };
  return { http, calls };
}

const ITEM = storeItem('pub-123', 'abcdefghijklmnopabcdefghijklmnop');
const ZIP = Uint8Array.of(0x50, 0x4b, 3, 4);
const noSleep = { sleep: () => Promise.resolve() };

describe('storeItem', () => {
  it('defaults to a staged publish', () => {
    expect(ITEM).toEqual({
      publisherId: 'pub-123',
      extensionId: 'abcdefghijklmnopabcdefghijklmnop',
      publishType: 'STAGED_PUBLISH',
    });
    expect(storeItem('p', 'abcdefghijklmnopabcdefghijklmnop', 'DEFAULT_PUBLISH').publishType).toBe(
      'DEFAULT_PUBLISH',
    );
  });

  it.each([
    ['../x', 'abcdefghijklmnopabcdefghijklmnop', 'STAGED_PUBLISH', 'CWS_PUBLISHER_ID'],
    ['pub', 'not-an-id', 'STAGED_PUBLISH', 'CWS_EXTENSION_ID'],
    ['pub', 'abcdefghijklmnopabcdefghijklmnoz', 'STAGED_PUBLISH', 'CWS_EXTENSION_ID'],
    ['pub', 'abcdefghijklmnopabcdefghijklmnop', 'PUBLISH_NOW', 'CWS_PUBLISH_TYPE'],
  ])('rejects publisher %j, extension %j, type %j', (publisher, extension, type, message) => {
    expect(() => storeItem(publisher, extension, type)).toThrow(message);
  });
});

describe('accessToken', () => {
  it('exchanges the refresh token for an access token', async () => {
    const { http, calls } = fakeHttp([[200, { access_token: 'ya29.token', expires_in: 3599 }]]);
    await expect(
      accessToken(http, { clientId: 'id', clientSecret: 's3', refreshToken: 'r&t' }),
    ).resolves.toBe('ya29.token');
    expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');
    expect(calls[0]?.body).toBe(
      'client_id=id&client_secret=s3&refresh_token=r%26t&grant_type=refresh_token',
    );
  });

  it('reports a refused exchange and a response without a token', async () => {
    await expect(
      accessToken(fakeHttp([[400, { error: 'invalid_grant' }]]).http, {
        clientId: 'a',
        clientSecret: 'b',
        refreshToken: 'c',
      }),
    ).rejects.toThrow('Token exchange failed with HTTP 400: {"error":"invalid_grant"}');
    await expect(
      accessToken(fakeHttp([[200, { token_type: 'Bearer' }]]).http, {
        clientId: 'a',
        clientSecret: 'b',
        refreshToken: 'c',
      }),
    ).rejects.toThrow('returned no access token');
    await expect(
      accessToken(fakeHttp([[200, 'not json']]).http, {
        clientId: 'a',
        clientSecret: 'b',
        refreshToken: 'c',
      }),
    ).rejects.toThrow('unexpected response');
  });
});

describe('uploadAndSubmit', () => {
  it('uploads with the V2 API, then submits for review', async () => {
    const { http, calls } = fakeHttp([
      [200, { uploadState: 'SUCCEEDED', crxVersion: '0.2.0' }],
      [200, { state: 'PENDING_REVIEW' }],
    ]);
    await expect(uploadAndSubmit(http, 'tok', ITEM, ZIP, noSleep)).resolves.toEqual({
      uploadState: 'SUCCEEDED',
      publishState: 'PENDING_REVIEW',
    });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      'POST https://chromewebstore.googleapis.com/upload/v2/publishers/pub-123/items/abcdefghijklmnopabcdefghijklmnop:upload',
      'POST https://chromewebstore.googleapis.com/v2/publishers/pub-123/items/abcdefghijklmnopabcdefghijklmnop:publish',
    ]);
    expect(calls[0]?.headers).toEqual({
      authorization: 'Bearer tok',
      'content-type': 'application/zip',
    });
    expect(calls[0]?.body).toBe(ZIP);
    expect(calls[1]?.body).toBe('{"publishType":"STAGED_PUBLISH"}');
  });

  it('polls while the store processes the upload (both state spellings)', async () => {
    const { http, calls } = fakeHttp([
      [200, { uploadState: 'IN_PROGRESS' }],
      [200, { lastAsyncUploadState: 'UPLOAD_IN_PROGRESS' }],
      [200, { lastAsyncUploadState: 'SUCCEEDED' }],
      [200, { state: 'PENDING_REVIEW' }],
    ]);
    const waits: number[] = [];
    await uploadAndSubmit(http, 't', ITEM, ZIP, {
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
      pollIntervalMs: 10,
    });
    expect(calls.filter((call) => call.url.endsWith(':fetchStatus'))).toHaveLength(2);
    expect(waits).toEqual([10, 10]);
  });

  it('stops polling after the limit and does not submit', async () => {
    const { http, calls } = fakeHttp([
      [200, { uploadState: 'IN_PROGRESS' }],
      [200, { lastAsyncUploadState: 'IN_PROGRESS' }],
      [200, { lastAsyncUploadState: 'IN_PROGRESS' }],
    ]);
    await expect(
      uploadAndSubmit(http, 't', ITEM, ZIP, { ...noSleep, maxPolls: 2 }),
    ).rejects.toThrow('still processing');
    expect(calls.some((call) => call.url.endsWith(':publish'))).toBe(false);
  });

  it('explains a rejected upload, typically an unchanged version', async () => {
    await expect(
      uploadAndSubmit(fakeHttp([[200, { uploadState: 'FAILED' }]]).http, 't', ITEM, ZIP, noSleep),
    ).rejects.toThrow(
      'Upload was not accepted (state: FAILED). Is the manifest version higher than the published one?',
    );
    await expect(
      uploadAndSubmit(fakeHttp([[200, {}]]).http, 't', ITEM, ZIP, noSleep),
    ).rejects.toThrow('state: unknown');
  });

  it('surfaces HTTP errors from upload and submit', async () => {
    await expect(
      uploadAndSubmit(
        fakeHttp([[403, { error: { message: 'forbidden' } }]]).http,
        't',
        ITEM,
        ZIP,
        noSleep,
      ),
    ).rejects.toThrow('Upload failed with HTTP 403');
    const submit = fakeHttp([
      [200, { uploadState: 'SUCCEEDED' }],
      [400, { error: 'item has warnings' }],
    ]);
    await expect(uploadAndSubmit(submit.http, 't', ITEM, ZIP, noSleep)).rejects.toBeInstanceOf(
      StoreError,
    );
  });
});
