/**
 * Two fixture servers for blocked cookies (#493): a page server, reached as
 * `127.0.0.1`, and an API server on another port, reached as `localhost`.
 * The two hosts are different sites, so a fetch from the page to the API is
 * cross-site.
 *
 * - API `/cookies/seed` (opened as a top-level page) stores `tp_lax`
 *   (`SameSite=Lax`) for `localhost`.
 * - Page `/cookies/page` sets `nosecure` (`SameSite=None` without `Secure`
 *   over http) and `wrongdomain` (`Domain=example.com`), which Chrome
 *   rejects, then fetches API `/cookies/api` with credentials: `tp_lax` is
 *   not sent. The page sets `window.cookieFetchDone` when the fetch ended.
 *
 * Every cookie value contains {@link COOKIE_SECRET}, which must never appear in
 * bdg's blocked cookie output or a default (sanitized) HAR.
 */

import * as http from 'http';

import type * as net from 'net';

/** Text in every fixture cookie value */
export const COOKIE_SECRET = 'cookie-secret-493';

/** Running cookie fixture servers */
export interface CookieFixtures {
  /** API page that stores `tp_lax` for localhost */
  seedUrl: string;
  /** Page that sets rejected cookies and makes the cross-site fetch */
  pageUrl: string;
  /** URL the page fetches */
  apiUrl: string;
  /** Stop both servers */
  close: () => Promise<void>;
}

/**
 * Start an HTTP server on an ephemeral port of 127.0.0.1.
 *
 * @param handler - Request handler
 * @returns The server and its port
 */
async function listen(
  handler: http.RequestListener
): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: (server.address() as net.AddressInfo).port };
}

/**
 * Stop a server, dropping open connections.
 *
 * @param server - Server
 */
async function stop(server: http.Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

/**
 * The page: rejected Set-Cookies and a credentialed fetch to the API.
 *
 * @param apiUrl - URL to fetch
 * @returns HTML
 */
function pageHtml(apiUrl: string): string {
  return `<!doctype html><title>cookies</title>
<script>
  fetch(${JSON.stringify(apiUrl)}, { credentials: 'include' })
    .catch(() => {})
    .finally(() => { window.cookieFetchDone = true; });
</script>`;
}

/**
 * Start the page and API servers.
 *
 * @returns Their URLs and a close function
 */
export async function startCookieFixtures(): Promise<CookieFixtures> {
  let pageOrigin = '';
  const api = await listen((req, res) => {
    if (req.url === '/cookies/seed') {
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'Set-Cookie': `tp_lax=${COOKIE_SECRET}; SameSite=Lax; Path=/`,
      });
      res.end('<!doctype html><title>seed</title><p>tp_lax stored</p>');
      return;
    }
    if (req.url !== '/cookies/api') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': pageOrigin,
      'Access-Control-Allow-Credentials': 'true',
    });
    res.end('{"ok":true}');
  });
  const apiUrl = `http://localhost:${api.port}/cookies/api`;
  const page = await listen((req, res) => {
    if (req.url !== '/cookies/page') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Set-Cookie': [
        `nosecure=${COOKIE_SECRET}; SameSite=None; Path=/`,
        `wrongdomain=${COOKIE_SECRET}; Domain=example.com; Path=/`,
      ],
    });
    res.end(pageHtml(apiUrl));
  });
  pageOrigin = `http://127.0.0.1:${page.port}`;

  return {
    seedUrl: `http://localhost:${api.port}/cookies/seed`,
    pageUrl: `${pageOrigin}/cookies/page`,
    apiUrl,
    close: async () => {
      await Promise.all([stop(api.server), stop(page.server)]);
    },
  };
}
