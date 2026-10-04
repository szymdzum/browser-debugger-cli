/**
 * Local fixture HTTP server and free-port helpers for smoke tests.
 *
 * Serves `src/__tests__/fixtures/index.html` plus a small JSON endpoint so smoke
 * tests never depend on the public internet. `/slow` delays its response so a
 * session start can be interrupted while the page is loading; `/redirect`
 * answers 302 to `/`; `/interactions` serves a form for input/key/click tests.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { fileURLToPath } from 'url';

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../__tests__/fixtures'
);
const FIXTURE_HTML = path.join(FIXTURES_DIR, 'index.html');
const INTERACTIONS_HTML = path.join(FIXTURES_DIR, 'interactions.html');

/** Delay for the `/slow` route, long enough to stop a session mid-startup. */
const SLOW_RESPONSE_MS = 8000;

/**
 * Running fixture server handle.
 */
export interface FixtureServer {
  /** Base URL, e.g. `http://127.0.0.1:53211/` */
  url: string;
  /** Stop the server */
  close: () => Promise<void>;
}

/**
 * Start the fixture server on an ephemeral port.
 *
 * @returns Server handle with its URL
 */
export async function startFixtureServer(): Promise<FixtureServer> {
  const html = fs.readFileSync(FIXTURE_HTML);
  const interactionsHtml = fs.readFileSync(INTERACTIONS_HTML);
  const server = http.createServer((req, res) => {
    if (req.url === '/slow') {
      const timer = setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
      }, SLOW_RESPONSE_MS);
      req.on('close', () => clearTimeout(timer));
      return;
    }
    if (req.url === '/interactions') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(interactionsHtml);
      return;
    }
    if (req.url === '/cookie') {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Set-Cookie': ['fixture_session=abc; Path=/; HttpOnly', 'fixture_theme=dark; Path=/'],
      });
      res.end('cookies set');
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }
    if (req.url === '/error-page') {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h1>Internal error</h1>');
      return;
    }
    if (req.url === '/api/test') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Get a currently free TCP port on 127.0.0.1.
 *
 * @returns Free port number
 */
export async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}
