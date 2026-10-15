import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface TestServer {
  /** `http://127.0.0.1:<port>`; covered by the E2E build's host permission. */
  readonly origin: string;
  close(): Promise<void>;
}

const PAGE = (title: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  response.end(body);
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * A deterministic local application, so browser tests never depend on a live
 * website. Endpoints:
 * - GET  /app.html, /next.html   plain pages
 * - GET  /api/items              200 JSON
 * - POST /api/orders             201, echoes the body length
 * - GET  /api/flaky              always 503
 * - GET  /api/status             200 JSON
 */
export async function startTestServer(): Promise<TestServer> {
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const route = `${request.method ?? 'GET'} ${url.pathname}`;
      switch (route) {
        case 'GET /app.html': {
          send(response, 200, 'text/html; charset=utf-8', PAGE('Test shop'));
          return;
        }
        case 'GET /next.html': {
          send(response, 200, 'text/html; charset=utf-8', PAGE('Next page'));
          return;
        }
        case 'GET /api/items': {
          send(response, 200, 'application/json', '{"items":[1,2,3]}');
          return;
        }
        case 'POST /api/orders': {
          const body = await readBody(request);
          send(response, 201, 'application/json', JSON.stringify({ received: body.length }));
          return;
        }
        case 'GET /api/flaky': {
          send(response, 503, 'application/json', '{"error":"unavailable"}');
          return;
        }
        case 'GET /api/status': {
          send(response, 200, 'application/json', '{"state":"ok"}');
          return;
        }
        default: {
          send(response, 404, 'text/plain', 'Not found');
          return;
        }
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Test server is not listening on a TCP port');
  }
  const { port } = address;
  return {
    origin: `http://127.0.0.1:${String(port)}`,
    close: () =>
      new Promise((resolve, reject) => {
        // The browser keeps connections alive; drop them so close() can finish.
        server.closeAllConnections();
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
}
