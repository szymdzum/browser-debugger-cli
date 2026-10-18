/**
 * Server for the `network details` timing smoke test (#837). The fixture
 * server cannot hold a response (`FixtureRoutes` are static HTML and
 * `fixtureServer.ts` is not edited for static pages), so the test starts this
 * one. `/` fetches, in order, `/wait` and `/download` together and then 8
 * `/hold` requests together, and sets the title to `done` when all are read:
 *
 * - `/wait` sends its headers after {@link DELAY_MS}: the server took the time.
 * - `/download` sends its headers at once and its body over {@link DELAY_MS}.
 * - `/hold`: the first {@link CONNECTION_LIMIT} requests that arrive are held
 *   for {@link DELAY_MS}, the rest are answered at once. Chrome opens at most
 *   6 HTTP/1.1 connections per host, so the 7th and 8th request wait in
 *   Chrome's queue until a held one finishes.
 */

import * as http from 'http';

import type { AddressInfo } from 'net';

/** How long the slow endpoints take */
export const DELAY_MS = 700;

/** Connections Chrome opens per host for HTTP/1.1 */
export const CONNECTION_LIMIT = 6;

/** Requests the page makes to `/hold` */
export const HOLD_REQUESTS = 8;

/** Chunks `/download` sends its body in */
const DOWNLOAD_CHUNKS = 7;

const PAGE = `<!doctype html><title>start</title>
<script>
const read = (url) => fetch(url).then((r) => r.text());
Promise.all([read('/wait'), read('/download')])
  .then(() => Promise.all(Array.from({ length: ${HOLD_REQUESTS} }, (_, i) => read('/hold?i=' + i))))
  .then(() => { document.title = 'done'; });
</script>`;

/** Running server */
export interface TimingServer {
  url: string;
  close: () => Promise<void>;
}

/**
 * Answer `/download`: headers at once, then a chunk every {@link DELAY_MS} / chunks.
 *
 * @param res - Response
 */
function trickleBody(res: http.ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.flushHeaders();
  let sent = 0;
  const timer = setInterval(() => {
    res.write('x'.repeat(1024));
    if (++sent === DOWNLOAD_CHUNKS) {
      clearInterval(timer);
      res.end();
    }
  }, DELAY_MS / DOWNLOAD_CHUNKS);
  res.on('close', () => clearInterval(timer));
}

/**
 * Start the server on a free port.
 *
 * @returns Its base URL (with a trailing slash) and a close function
 */
export async function startTimingServer(): Promise<TimingServer> {
  let holdArrivals = 0;
  const reply = (res: http.ServerResponse, delayMs: number): void => {
    const timer = setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('ok');
    }, delayMs);
    res.on('close', () => clearTimeout(timer));
  };
  const server = http.createServer((req, res) => {
    const route = new URL(req.url ?? '/', 'http://timing').pathname;
    if (route === '/wait') reply(res, DELAY_MS);
    else if (route === '/download') trickleBody(res);
    else if (route === '/hold') reply(res, ++holdArrivals <= CONNECTION_LIMIT ? DELAY_MS : 0);
    else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(PAGE);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
