import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const ASSETS = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(response, status, type, payload) {
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  });
  response.end(payload);
}

function json(response, status, value) {
  send(response, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

async function readCommand(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new RequestError(415, 'Send an application/json command.');
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > 1024) throw new RequestError(413, 'Command is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks));
  } catch {
    throw new RequestError(400, 'Invalid JSON command.');
  }
}

export async function createHttp(dashboard) {
  const staticFiles = new Map(await Promise.all([...ASSETS].map(async ([route, [name, mime]]) => [
    route, { mime, body: await readFile(new URL('../public/' + name, import.meta.url)) },
  ])));

  const server = createServer(async (request, response) => {
    try {
      const port = server.address().port;
      const hosts = new Set(['127.0.0.1:' + port, 'localhost:' + port]);
      if (!hosts.has(request.headers.host)) throw new RequestError(421, 'Use a loopback URL.');
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) {
        throw new RequestError(400, 'Use a local request path.');
      }
      const route = new URL(request.url, 'http://' + request.headers.host);
      if (route.pathname === '/api/control') {
        if (request.method !== 'POST') throw new RequestError(405, 'Use POST for a screen command.');
        if (request.headers.origin && request.headers.origin !== route.origin) {
          throw new RequestError(403, 'Only the dashboard can send screen commands.');
        }
        json(response, 200, await dashboard.control(await readCommand(request)));
        return;
      }
      if (request.method !== 'GET') throw new RequestError(405, 'Use GET for reads.');
      if (route.pathname === '/api/state') {
        json(response, 200, dashboard.snapshot());
        return;
      }
      const frame = /^\/api\/frame\/([1-8])$/.exec(route.pathname);
      if (frame) {
        const parameter = route.searchParams.get('rev');
        if (parameter !== null && !/^[1-9]\d{0,11}$/.test(parameter)) {
          throw new RequestError(400, 'Choose a valid frame revision.');
        }
        const image = dashboard.frame(Number(frame[1]), parameter === null ? undefined : Number(parameter));
        if (!image) throw new RequestError(404, 'Frame is no longer available.');
        send(response, 200, 'image/jpeg', image);
        return;
      }
      const asset = staticFiles.get(route.pathname);
      if (!asset) throw new RequestError(404, 'Unknown route.');
      send(response, 200, asset.mime, asset.body);
    } catch (error) {
      if (error instanceof RequestError) json(response, error.status, { error: error.message });
      else if (error instanceof RangeError) json(response, 400, { error: error.message });
      else json(response, 503, { error: 'The browser worker could not finish this command.' });
    }
  });
  return server;
}
