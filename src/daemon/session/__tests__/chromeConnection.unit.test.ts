/**
 * Attaching to an external Chrome (`--chrome-ws-url`).
 */

import * as assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import {
  externalChromePort,
  findPageTarget,
  setupChromeConnection,
  tabWebSocketUrl,
} from '@/daemon/session/chromeConnection.js';
import type { SessionConfig } from '@/daemon/session/types.js';
import { CommandError } from '@/errors/index.js';
import type { CDPTarget } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const BROWSER_URL = 'ws://127.0.0.1:9333/devtools/browser/b-1';

/** A page as Chrome lists it (Chrome names its own host) */
const PAGE: CDPTarget = {
  id: 'p-1',
  type: 'page',
  title: 'Open tab',
  url: 'https://example.com/',
  webSocketDebuggerUrl: 'ws://localhost:9333/devtools/page/p-1',
};

/**
 * Serve Chrome's HTTP endpoint from canned answers.
 *
 * @param list - `/json/list` answer, or null when Chrome is unreachable
 *   (`/json/version` names browser id b-1)
 * @param created - `/json/new` answer
 * @returns Requested URLs and methods
 */
function mockChromeHttp(list: CDPTarget[] | null, created?: CDPTarget): string[] {
  const requests: string[] = [];
  mock.method(globalThis, 'fetch', (url: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${url}`);
    if (list === null) return Promise.reject(new Error('ECONNREFUSED'));
    const version = { webSocketDebuggerUrl: 'ws://localhost:9333/devtools/browser/b-1' };
    const body = url.includes('/json/version')
      ? version
      : url.includes('/json/new')
        ? created
        : list;
    return Promise.resolve(new Response(JSON.stringify(body), { status: body ? 200 : 500 }));
  });
  return requests;
}

/**
 * Run the external Chrome setup for a `--chrome-ws-url` value.
 *
 * @param chromeWsUrl - WebSocket URL given by the user
 * @returns The target the session will connect to
 */
async function attach(chromeWsUrl: string): Promise<CDPTarget | null> {
  const store = new TelemetryStore();
  const config: SessionConfig = {
    url: 'http://127.0.0.1:47802/',
    port: externalChromePort(chromeWsUrl),
    telemetry: [],
    includeAll: false,
    headless: true,
    chromeWsUrl,
  };
  await setupChromeConnection(config, store, createLogger('session'), () => undefined);
  return store.targetInfo;
}

void describe('external Chrome', () => {
  afterEach(() => mock.restoreAll());

  void it('takes the port from the WebSocket URL', () => {
    assert.equal(externalChromePort(BROWSER_URL), 9333);
    assert.equal(externalChromePort('wss://chrome.example/devtools/browser/x'), 443);
  });

  void it('attaches a browser-level URL to an open page, through the given host', async () => {
    mockChromeHttp([PAGE]);

    const target = await attach(BROWSER_URL);

    assert.equal(target?.id, 'p-1');
    assert.equal(target?.webSocketDebuggerUrl, 'ws://127.0.0.1:9333/devtools/page/p-1');
  });

  void it('opens a page when the browser has none', async () => {
    const requests = mockChromeHttp([], PAGE);

    const target = await attach(BROWSER_URL);

    assert.equal(target?.id, 'p-1');
    assert.ok(requests.includes('PUT http://127.0.0.1:9333/json/new?about:blank'));
  });

  void it('reaches a wss browser URL over HTTPS and keeps wss for the page', async () => {
    const requests = mockChromeHttp([PAGE]);

    const target = await attach('wss://chrome.example/devtools/browser/b-1');

    assert.ok(requests.includes('GET https://chrome.example:443/json/list'));
    assert.equal(target?.webSocketDebuggerUrl, 'wss://chrome.example/devtools/page/p-1');
  });

  void it('fails when the browser has no page and cannot open one', async () => {
    mockChromeHttp([]);

    await assert.rejects(attach(BROWSER_URL), /Cannot reach the Chrome DevTools endpoint/);
  });

  void it('fails fast with a suggestion when the browser cannot be reached', async () => {
    mockChromeHttp(null);

    await assert.rejects(attach(BROWSER_URL), (error: unknown) => {
      assert.ok(error instanceof CommandError);
      assert.equal(error.exitCode, EXIT_CODES.CDP_CONNECTION_FAILURE);
      assert.match(error.message, /http:\/\/127\.0\.0\.1:9333/);
      assert.match(String(error.metadata['suggestion']), /--remote-debugging-port/);
      return true;
    });
  });

  void it('uses a page URL as given, with the page details when Chrome lists it', async () => {
    mockChromeHttp([PAGE]);
    const pageUrl = 'ws://127.0.0.1:9333/devtools/page/p-1';

    const target = await attach(pageUrl);

    assert.equal(target?.webSocketDebuggerUrl, pageUrl);
    assert.equal(target?.title, 'Open tab');
  });

  void it('refuses an unknown page id or a stale browser id (83)', async () => {
    mockChromeHttp([PAGE]);

    for (const [url, message] of [
      ['ws://127.0.0.1:9333/devtools/page/gone', /No page with id gone/],
      ['ws://127.0.0.1:9333/devtools/browser/old', /different browser id/],
    ] as const) {
      await assert.rejects(attach(url), (error: unknown) => {
        assert.ok(error instanceof CommandError);
        assert.equal(error.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
        assert.match(error.message, message);
        return true;
      });
    }
  });
});

void describe('launched Chrome', () => {
  afterEach(() => mock.restoreAll());

  void it('opens a page when Chrome has not opened its first tab yet', async () => {
    const requests = mockChromeHttp([], PAGE);
    const store = new TelemetryStore();
    const config: SessionConfig = {
      url: 'http://127.0.0.1:47802/',
      port: 9444,
      telemetry: [],
      includeAll: false,
      headless: true,
    };

    await findPageTarget(config, store, createLogger('session'));

    assert.equal(store.targetInfo?.id, 'p-1');
    assert.ok(requests.includes('PUT http://127.0.0.1:9444/json/new?about:blank'));
  });
});

void describe('tabWebSocketUrl', () => {
  void it('reaches another tab the way the session page is reached', () => {
    assert.equal(
      tabWebSocketUrl('ws://127.0.0.1:9222/devtools/page/AAA', 'BBB'),
      'ws://127.0.0.1:9222/devtools/page/BBB'
    );
    assert.equal(
      tabWebSocketUrl('wss://chrome.example.test/devtools/page/AAA?token=x', 'BBB'),
      'wss://chrome.example.test/devtools/page/BBB?token=x'
    );
    assert.equal(
      tabWebSocketUrl('wss://host.test/prefix/devtools/page/AAA', 'B/B'),
      'wss://host.test/prefix/devtools/page/B%2FB'
    );
  });
});
