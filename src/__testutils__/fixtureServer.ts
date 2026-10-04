/**
 * Local fixture HTTP server and free-port helpers for smoke tests.
 *
 * Serves `src/__tests__/fixtures/index.html` plus a small JSON endpoint so smoke
 * tests never depend on the public internet. `/slow` delays its response so a
 * session start can be interrupted while the page is loading; `/redirect`
 * answers 302 to `/`; `/interactions` serves a form for input/key/click tests;
 * `/ws` is a WebSocket echo server; `/frames` embeds a cross-origin iframe
 * (`localhost` vs `127.0.0.1`), starts a worker and requests a missing image;
 * `/deep` has controls inside an open shadow root and a same-origin iframe.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { WebSocketServer } from 'ws';

const FIXTURES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../__tests__/fixtures'
);
const FIXTURE_HTML = path.join(FIXTURES_DIR, 'index.html');
const INTERACTIONS_HTML = path.join(FIXTURES_DIR, 'interactions.html');

/** Delay for the `/slow` route, long enough to stop a session mid-startup. */
const SLOW_RESPONSE_MS = 8000;

/** 1x1 PNG served at /pixel.png (binary response bodies). */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Page whose console output comes from other targets and from the browser. */
const FRAMES_HTML = `<!doctype html><title>frames</title>
<img src="/not-found.png">
<script>
  const frame = document.createElement('iframe');
  frame.src = 'http://localhost:' + location.port + '/frame-child';
  document.body.append(frame);
  new Worker(URL.createObjectURL(new Blob(['console.warn("from worker")'])));
</script>`;

/** Cross-origin iframe content: logs an object that needs expansion. */
const FRAME_CHILD_HTML = `<!doctype html><script>
  console.log('from cross-origin frame', { nested: { deep: { value: 42 } } });
</script>`;

/** Page with controls in an open shadow root and in a same-origin iframe. */
const DEEP_HTML = `<!doctype html><title>deep</title>
<p class="note">li<b>ght</b><span hidden> secret</span></p>
<shadow-form></shadow-form>
<iframe src="/deep-frame" style="margin-top: 40px; width: 400px; height: 200px; padding: 25px; border: 6px solid"></iframe>
<script>
  window.events = [];
  customElements.define('shadow-form', class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<p class="note">shadow</p><input id="shadow-input">' +
        '<button id="shadow-button">Shadow</button>';
      root.getElementById('shadow-button').onclick = () => window.events.push('shadow-click');
      root.getElementById('shadow-input').onkeydown = (e) => window.events.push('shadow-key:' + e.key);
    }
  });
</script>`;

/** Same-origin iframe content of `/deep`. */
const DEEP_FRAME_HTML = `<!doctype html><p class="note">frame</p>
<input id="frame-input" aria-label="Frame field">
<button id="frame-button" style="margin-left: 120px">Frame</button>
<script>
  document.getElementById('frame-button').onclick = () => parent.events.push('frame-click');
  document.getElementById('frame-input').onkeydown = (e) => parent.events.push('frame-key:' + e.key);
</script>`;

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
    if (req.url === '/pixel.png') {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(PIXEL_PNG);
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
    if (req.url === '/deep' || req.url === '/deep-frame') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(req.url === '/deep' ? DEEP_HTML : DEEP_FRAME_HTML);
      return;
    }
    if (req.url === '/frames' || req.url === '/frame-child') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(req.url === '/frames' ? FRAMES_HTML : FRAME_CHILD_HTML);
      return;
    }
    if (req.url === '/not-found.png') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('missing');
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

  const echo = new WebSocketServer({ server, path: '/ws' });
  echo.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolve) => {
        echo.clients.forEach((socket) => socket.terminate());
        echo.close();
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
