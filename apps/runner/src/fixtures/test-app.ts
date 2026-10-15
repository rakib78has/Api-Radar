import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

/**
 * Fixed so recorded baselines (which contain the origin) stay valid between
 * runs. Override with API_QA_TEST_APP_PORT if the port is taken.
 */
export const TEST_APP_PORT = Number(process.env.API_QA_TEST_APP_PORT ?? '47130');
export const TEST_APP_ORIGIN = `http://127.0.0.1:${String(TEST_APP_PORT)}`;

/**
 * Scenario scripts. Each is the body of an async function run on page load;
 * parameters come from the query string as `param(name, default)`. When the
 * script finishes, the body gets data-state="done" (or "error").
 */
const SCENARIOS: Readonly<Record<string, string>> = {
  single: `await get('/api/items');`,
  'duplicate-get': `await Promise.all([get('/api/items'), get('/api/items')]);`,
  'query-params': `await get('/api/items?page=1'); await get('/api/items?page=2');`,
  'resource-ids': `await get('/api/users/1'); await get('/api/users/2');`,
  concurrent: `await Promise.all(['/api/users/1', '/api/orders', '/api/settings'].map((url) => get(url)));`,
  retry: `
    const attempts = param('attempts', 3), fail = param('fail', 2), delay = param('delay', 150);
    const key = Math.random().toString(36).slice(2);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const response = await fetch('/api/flaky?key=' + key + '&fail=' + fail);
      await response.text();
      if (response.ok) break;
      await sleep(delay);
    }`,
  polling: `
    const interval = param('interval', 200), count = param('count', 6);
    for (let i = 0; i < count; i++) {
      await get('/api/status');
      if (i < count - 1) await sleep(interval);
    }`,
  spa: `
    const interval = param('interval', 150), before = param('before', 3);
    const after = param('after', 700), fixed = param('fixed', 0) === 1;
    const timer = setInterval(() => { void get('/api/status'); }, interval);
    await sleep(interval * before + interval / 2);
    if (fixed) clearInterval(timer);
    history.pushState({}, '', '/s/spa-settings');
    document.querySelector('h1').textContent = 'Settings';
    await get('/api/settings');
    await sleep(after);
    clearInterval(timer);
    await sleep(100);`,
  forbidden: `await get('/api/v1/legacy'); await get('/api/items');`,
  count: `
    const n = param('n', 2);
    for (let i = 0; i < n; i++) await get('/api/cart');`,
  redaction: `
    await get('/api/search?q=shoes&access_token=RUNNER-SECRET-1');
    await (await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user: 'jane', password: 'RUNNER-SECRET-2' }),
    })).text();
    await get('/api/reset/aZ9bY8cX7dW6eV5fU4gT3hS2iR1jQ0kP5RunnerSecret3');
    history.pushState({}, '', '/s/redaction?session=RUNNER-SECRET-4');`,
  idle: ``,
};

function page(title: string, script: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="icon" href="data:,"></head>
<body data-state="running"><h1>${title}</h1>
<script>
const params = new URLSearchParams(location.search);
const param = (name, fallback) => (params.has(name) ? Number(params.get(name)) : fallback);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const get = async (url) => (await fetch(url)).text();
(async () => {
${script}
})().then(
  () => { document.body.dataset.state = 'done'; },
  (error) => { document.body.dataset.state = 'error'; document.body.dataset.error = String(error); },
);
</script></body></html>`;
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

const json = (response: ServerResponse, status: number, value: unknown) => {
  send(response, status, 'application/json', JSON.stringify(value));
};

async function drain(request: IncomingMessage): Promise<number> {
  let length = 0;
  for await (const chunk of request) {
    length += Buffer.isBuffer(chunk) ? chunk.length : String(chunk).length;
  }
  return length;
}

/** Failures served so far per /api/flaky key. Bounded so a long run cannot grow it forever. */
const flakyCounters = new Map<string, number>();

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', TEST_APP_ORIGIN);
  const method = request.method ?? 'GET';
  const { pathname } = url;

  const scenario = /^\/s\/([a-z-]+)$/.exec(pathname)?.[1];
  if (method === 'GET' && scenario !== undefined) {
    const script = SCENARIOS[scenario] ?? (scenario === 'spa-settings' ? '' : undefined);
    if (script !== undefined) {
      send(response, 200, 'text/html; charset=utf-8', page(`Scenario: ${scenario}`, script));
      return;
    }
  }

  if (method === 'POST' && (pathname === '/api/login' || pathname === '/api/orders')) {
    json(response, 201, { received: await drain(request) });
    return;
  }
  if (method !== 'GET') {
    json(response, 405, { error: 'method not allowed' });
    return;
  }
  if (pathname === '/api/flaky') {
    const key = url.searchParams.get('key') ?? '';
    const fail = Number(url.searchParams.get('fail') ?? '0');
    const served = flakyCounters.get(key) ?? 0;
    if (flakyCounters.size > 10_000) {
      flakyCounters.clear();
    }
    flakyCounters.set(key, served + 1);
    json(response, served < fail ? 503 : 200, { attempt: served + 1 });
    return;
  }
  if (pathname === '/api/slow') {
    const ms = Math.min(Number(url.searchParams.get('ms') ?? '1000'), 10_000);
    await new Promise((resolve) => setTimeout(resolve, ms));
    json(response, 200, { waited: ms });
    return;
  }
  if (
    /^\/api\/(items|orders|settings|status|cart|search|v1\/legacy|users\/\d+|reset\/[\w-]+)$/.test(
      pathname,
    )
  ) {
    json(response, 200, { ok: true, path: pathname });
    return;
  }
  send(response, 404, 'text/plain', 'Not found');
}

/** Starts the controlled test application. Used by Playwright global setup. */
export async function startTestApp(port = TEST_APP_PORT): Promise<Server> {
  const server = createServer((request, response) => {
    handle(request, response).catch(() => {
      send(response, 500, 'text/plain', 'Test app error');
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error) => {
      reject(
        new Error(`Test app could not listen on port ${String(port)}; set API_QA_TEST_APP_PORT`, {
          cause: error,
        }),
      );
    });
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

export function stopTestApp(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
