/**
 * Session download setup: which connection follows downloads (browser-level,
 * the page's as a fallback or after the browser-level one is lost, only the
 * page's when attached to the user's Chrome) and what behavior it sets.
 */

import assert from 'node:assert/strict';
import * as path from 'node:path';
import { after, afterEach, beforeEach, describe, it } from 'node:test';

import { makeTempDir, removeTempDirs } from '@/__testutils__/tempDirs.js';
import type { CDPConnection } from '@/connection/cdp.js';
import { TelemetryStore } from '@/daemon/session/TelemetryStore.js';
import { startSessionDownloads, type BrowserConnector } from '@/daemon/session/downloads.js';
import type { SessionConfig } from '@/daemon/session/types.js';
import type { CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';

/** CDP connection mock that records commands. */
class MockCDP {
  readonly sent: Array<{ method: string; params: unknown }> = [];
  closed = false;

  /**
   * Record a command.
   *
   * @param method - CDP method
   * @param params - Its parameters
   * @returns Empty result
   */
  send(method: string, params?: unknown): Promise<unknown> {
    this.sent.push({ method, params });
    return Promise.resolve({});
  }

  /**
   * Subscribe to an event (never emitted here).
   *
   * @returns Unsubscribe function
   */
  on(): () => void {
    return () => undefined;
  }

  /** Close the connection. */
  close(): void {
    this.closed = true;
  }

  /**
   * The `Browser.setDownloadBehavior` calls received.
   *
   * @returns Their parameters
   */
  behaviors(): unknown[] {
    return this.sent
      .filter((command) => command.method === 'Browser.setDownloadBehavior')
      .map((command) => command.params);
  }
}

const logger = createLogger('session');
const savedSessionDir = process.env['BDG_SESSION_DIR'];
let sessionDir: string;

beforeEach(() => {
  sessionDir = makeTempDir('bdg-downloads-session-');
  process.env['BDG_SESSION_DIR'] = sessionDir;
});

afterEach(() => {
  if (savedSessionDir === undefined) delete process.env['BDG_SESSION_DIR'];
  else process.env['BDG_SESSION_DIR'] = savedSessionDir;
});

after(removeTempDirs);

/**
 * Start a session's download tracking.
 *
 * @param page - Page connection mock
 * @param config - Session configuration
 * @param connector - Browser-level connector
 * @returns Cleanup
 */
function start(
  page: MockCDP,
  config: Partial<SessionConfig>,
  connector: BrowserConnector
): Promise<CleanupFunction> {
  return startSessionDownloads(
    {
      cdp: page as unknown as CDPConnection,
      config: { url: 'http://x.test', port: 9222, ...config },
      store: new TelemetryStore(),
      logger,
    },
    connector
  );
}

/**
 * Behavior that saves into the session's downloads directory.
 *
 * @returns `Browser.setDownloadBehavior` parameters
 */
function sessionDirBehavior(): unknown {
  return {
    behavior: 'allowAndName',
    downloadPath: path.join(sessionDir, 'downloads'),
    eventsEnabled: true,
  };
}

void describe('startSessionDownloads', () => {
  void it('follows downloads on a browser-level connection, closed at cleanup', async () => {
    const page = new MockCDP();
    const browser = new MockCDP();
    const stop = await start(page, {}, () => Promise.resolve(browser as unknown as CDPConnection));

    assert.deepEqual(browser.behaviors(), [sessionDirBehavior()]);
    assert.deepEqual(page.behaviors(), []);
    await stop();
    assert.equal(browser.closed, true);
  });

  void it('falls back to the page connection when Chrome has no browser-level one', async () => {
    const page = new MockCDP();
    await start(page, {}, () => Promise.resolve(null));

    assert.deepEqual(page.behaviors(), [sessionDirBehavior()]);
  });

  void it('sets the behavior again on the page when the browser-level connection is lost', async () => {
    const page = new MockCDP();
    let lose = (): void => undefined;
    await start(page, {}, (_config, _logger, onLost) => {
      lose = onLost;
      return Promise.resolve(new MockCDP() as unknown as CDPConnection);
    });
    assert.deepEqual(page.behaviors(), []);

    lose();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(page.behaviors(), [sessionDirBehavior()]);
  });

  void it('uses only the page connection of an attached Chrome, keeping its settings', async () => {
    const page = new MockCDP();
    let connected = false;
    await start(page, { chromeWsUrl: 'ws://127.0.0.1:9222/devtools/browser/abc' }, () => {
      connected = true;
      return Promise.resolve(null);
    });

    assert.equal(connected, false);
    assert.deepEqual(page.behaviors(), [{ behavior: 'default', eventsEnabled: true }]);
  });
});
