/**
 * Server for the HAR `bodySize` smoke test (#796). The fixture server cannot
 * send a gzip body (`FixtureRoutes` are HTML strings answered `text/html`
 * with no extra headers, and `fixtureServer.ts` is not edited for static
 * pages), so the test starts this one: `/` reads `/gzip` and `/plain` to the end
 * (a body nobody reads never finishes loading) and sets the title to `done`.
 */

import * as http from 'http';
import * as zlib from 'zlib';

import type { AddressInfo } from 'net';

/** Text repeated until it compresses well, so gzip is far smaller than the plain body */
const GZIP_SOURCE = 'compressible body line\n'.repeat(400);
/** Body of `/plain`, sent as is */
const PLAIN_BODY = 'p'.repeat(700);

/** The gzip body as it goes on the wire */
export const GZIP_BODY: Buffer = zlib.gzipSync(GZIP_SOURCE);
/** Decoded length of `/gzip` */
export const GZIP_DECODED_LENGTH: number = Buffer.byteLength(GZIP_SOURCE);
/** Length of `/plain` */
export const PLAIN_LENGTH: number = Buffer.byteLength(PLAIN_BODY);

const PAGE = `<!doctype html><title>start</title>
<script>
Promise.all(['/gzip', '/plain'].map((p) => fetch(p).then((r) => r.arrayBuffer()))).then(() => { document.title = 'done'; });
</script>`;

/** Running server */
export interface EncodedBodyServer {
  url: string;
  close: () => Promise<void>;
}

/**
 * Start the server on a free port.
 *
 * @returns Its base URL (with a trailing slash) and a close function
 */
export async function startEncodedBodyServer(): Promise<EncodedBodyServer> {
  const server = http.createServer((req, res) => {
    if (req.url === '/gzip') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Encoding': 'gzip',
        'Content-Length': GZIP_BODY.length,
        'Cache-Control': 'no-store',
      });
      res.end(GZIP_BODY);
    } else if (req.url === '/plain') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': PLAIN_LENGTH,
        'Cache-Control': 'no-store',
      });
      res.end(PLAIN_BODY);
    } else {
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
