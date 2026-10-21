/**
 * A programmable hostile server for the load-failure matrix (#862): one HTTP
 * server on a free port where every failure a navigation can meet has a path
 * of its own, plus the URLs of failures that need no server (an unresolvable
 * host, a closed port, TLS spoken to a plain-HTTP port, a file in a temp dir).
 *
 * Paths of the HTTP server:
 *
 * - `/status/<204|304|404|500>` and `/status/<404|500>-body`: that status with
 *   an empty body, or with an HTML page that has a title.
 * - `/reset`: sends the headers and part of the body, then resets the connection.
 *   `/reset-early`: closes the connection before sending a byte.
 * - `/hang`: reads the request and never answers. `/endless`: answers with a
 *   page and keeps the body open for ever.
 * - `/truncated`: the headers promise 4096 bytes, the body
 *   ends after a few.
 * - `/redirect-loop`: redirects to itself. `/redirect-chrome`, `/redirect-about`:
 *   redirect to `chrome://version` and `about:blank`. `/redirect/<url>`
 *   (the URL percent-encoded, so a GET form keeps it): a 302 to `<url>`,
 *   whatever its scheme (#890: `myapp://`, `javascript:`).
 * - `/download`: a CSV sent as an attachment (no document).
 * - `/csp`: a page whose Content-Security-Policy blocks its own script.
 * - `/ok`: a plain page that loads.
 * - `/launch-blob`: like `/launch`, leading to a `blob:` URL the page makes of
 *   an HTML page titled `Hostile blob` (a blob URL exists only in the
 *   document that made it, so no command can be given one).
 * - `/launch?to=<url>`: a page with a link (`#go`) and a GET form with a submit
 *   button (`#send` in `#form`) that both lead to `<url>`; the form has a
 *   `hidden` field so the query string does not hide the failure.
 */

import * as fs from 'fs';
import * as http from 'http';
import * as net from 'net';
import * as path from 'path';

import { makeTempDir } from '@/__testutils__/tempDirs.js';

/** Bytes the headers of `/truncated` and `/reset` promise */
const PROMISED_BYTES = 4096;

/** Path prefix of the redirects to any URL */
const REDIRECT_PREFIX = '/redirect/';

/** Title of the pages that load */
const OK_TITLE = 'Hostile OK';

/** Title of the `/status/*-body` pages */
const BODY_TITLE = 'Hostile body';

/** Title of the page the `blob:` URL of `/launch-blob` holds */
const BLOB_TITLE = 'Hostile blob';

/** What a throwaway file the server wrote holds */
const FILE_TITLE = 'Hostile file';

/** Running server and the URLs that need none */
export interface HostileServer {
  /** Base URL with a trailing slash */
  url: string;
  /** A URL on a port where nothing listens (connection refused) */
  refusedUrl: string;
  /** `https://` to the plain-HTTP port (`ERR_SSL_PROTOCOL_ERROR`) */
  tlsToPlainUrl: string;
  /** A host that never resolves (RFC 6761 `.invalid`) */
  unresolvableUrl: string;
  /** `file://` URL of an existing page */
  fileUrl: string;
  /** `file://` URL of a file that does not exist */
  missingFileUrl: string;
  /** Page with a link and a form that lead to `target` */
  launchUrl: (target: string) => string;
  /** A URL that redirects (302) to `target` */
  redirectUrl: (target: string) => string;
  /** Close the server and its connections */
  close: () => Promise<void>;
}

/**
 * An HTML page.
 *
 * @param title - Document title
 * @returns Source
 */
function page(title: string): string {
  return `<!doctype html><title>${title}</title><h1>${title}</h1>`;
}

/**
 * The link and the form of `/launch`.
 *
 * @param target - Where they lead
 * @returns Source
 */
function launchPage(target: string): string {
  const escaped = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!doctype html><title>Launch</title>
<a id="go" href="${escaped}">go</a>
<form id="form" action="${escaped}" method="get"><input type="hidden" name="q" value="1"><button id="send" type="submit">send</button></form>`;
}

/** The link and the form of `/launch-blob` */
const LAUNCH_BLOB_PAGE = `<!doctype html><title>Launch blob</title>
<a id="go">go</a>
<form id="form" method="get"><button id="send" type="submit">send</button></form>
<script>
const blob = URL.createObjectURL(new Blob(['${page(BLOB_TITLE)}'], { type: 'text/html' }));
document.getElementById('go').href = blob;
document.getElementById('form').action = blob;
</script>`;

/**
 * Answer with a status and either no body or a page.
 *
 * @param res - Response
 * @param status - Status code
 * @param withBody - Send an HTML page
 */
function sendStatus(res: http.ServerResponse, status: number, withBody: boolean): void {
  if (withBody) {
    res.writeHead(status, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(page(BODY_TITLE));
    return;
  }
  res.writeHead(status, { 'Cache-Control': 'no-store' });
  res.end();
}

/**
 * Send headers that promise 4096 and a few bytes of body.
 *
 * @param res - Response
 * @param flushed - Called once the short body is written
 * @returns The socket, to end or reset it
 */
function sendPartial(res: http.ServerResponse, flushed?: () => void): net.Socket {
  res.writeHead(200, {
    'Content-Type': 'text/html',
    'Content-Length': PROMISED_BYTES,
    'Cache-Control': 'no-store',
  });
  res.write('<!doctype html><title>Partial</title><p>cut', flushed);
  return res.socket as net.Socket;
}

/**
 * Handle one request.
 *
 * @param req - Request
 * @param res - Response
 */
function handle(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url ?? '/', 'http://hostile');
  const route = url.pathname;
  const status = /^\/status\/(\d{3})(-body)?$/.exec(route);
  if (status) return sendStatus(res, Number(status[1]), status[2] !== undefined);
  if (route.startsWith(REDIRECT_PREFIX)) {
    res.writeHead(302, { Location: decodeURIComponent(route.slice(REDIRECT_PREFIX.length)) });
    res.end();
    return;
  }
  switch (route) {
    case '/reset':
      sendPartial(res).resetAndDestroy();
      return;
    case '/reset-early':
      req.socket.destroy();
      return;
    case '/hang':
      return;
    case '/endless':
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      res.write('<!doctype html><title>Endless</title><p>and on');
      return;
    case '/truncated':
      sendPartial(res, () => res.socket?.destroy());
      return;
    case '/redirect-loop':
      res.writeHead(302, { Location: '/redirect-loop' });
      res.end();
      return;
    case '/redirect-chrome':
      res.writeHead(302, { Location: 'chrome://version' });
      res.end();
      return;
    case '/download':
      res.writeHead(200, {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename=hostile.csv',
      });
      res.end('a,b\n1,2\n');
      return;
    case '/redirect-about':
      res.writeHead(302, { Location: 'about:blank' });
      res.end();
      return;
    case '/csp':
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Content-Security-Policy': "script-src 'none'",
      });
      res.end(`${page('Hostile CSP')}<script>document.title = 'script ran'</script>`);
      return;
    case '/launch-blob':
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(LAUNCH_BLOB_PAGE);
      return;
    case '/launch':
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(launchPage(url.searchParams.get('to') ?? '/ok'));
      return;
    default:
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(page(OK_TITLE));
  }
}

/**
 * A port where nothing listens: bound for a moment, then released.
 *
 * @returns The port
 */
async function closedPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/**
 * Start the server.
 *
 * @returns The server and the URLs of the failures that need none
 */
export async function startHostileServer(): Promise<HostileServer> {
  const server = http.createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  const url = `http://127.0.0.1:${port}/`;
  const dir = makeTempDir('bdg-hostile-');
  const file = path.join(dir, 'page.html');
  fs.writeFileSync(file, page(FILE_TITLE));
  const refused = await closedPort();
  return {
    url,
    refusedUrl: `http://127.0.0.1:${refused}/`,
    tlsToPlainUrl: `https://127.0.0.1:${port}/`,
    unresolvableUrl: 'http://hostile.invalid/',
    fileUrl: `file://${file}`,
    missingFileUrl: `file://${path.join(dir, 'missing.html')}`,
    launchUrl: (target) => `${url}launch?to=${encodeURIComponent(target)}`,
    redirectUrl: (target) => `${url}redirect/${encodeURIComponent(target)}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
