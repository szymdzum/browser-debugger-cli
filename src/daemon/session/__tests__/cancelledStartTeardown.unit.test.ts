/**
 * A start cancelled by a stop ends its Chrome at once (#801): Chrome gets a
 * short grace window after Browser.close and is then killed, instead of the
 * graceful shutdown's 5 s waits (Chrome's own exit takes seconds on a loaded
 * or cold machine). The stand-in Chrome answers Browser.close but never
 * exits by itself and ignores SIGTERM.
 */

import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { afterEach, describe, it } from 'node:test';

import type { CDPConnection } from '@/connection/cdp.js';
import { releaseConnection, terminateChrome } from '@/daemon/session/teardown.js';
import type { LaunchedChrome } from '@/types.js';
import type { Logger } from '@/ui/logging/index.js';
import { isProcessAlive } from '@/utils/process.js';

const silentLog = Object.assign(() => undefined, {
  info: () => undefined,
  debug: () => undefined,
}) as unknown as Logger;

/** The cancelled start's whole teardown must end well within the 1.5 s the stop has */
const CANCELLED_TEARDOWN_MAX_MS = 1500;

let child: ChildProcess | undefined;

/**
 * Spawn a process that ignores SIGTERM and stays alive, in its own process
 * group (as Chrome is), standing in for a launched Chrome.
 *
 * @returns The stand-in, killable as chrome-launcher does (SIGKILL to the group)
 */
async function stubbornChrome(): Promise<LaunchedChrome> {
  child = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('up')"],
    { detached: true, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  await new Promise((resolve) => child?.stdout?.once('data', resolve));
  const pid = child.pid as number;
  return {
    pid,
    port: 0,
    kill: () => {
      process.kill(-pid, 'SIGKILL');
      return Promise.resolve();
    },
  };
}

void describe('cancelled start teardown', () => {
  afterEach(() => {
    if (child?.pid && isProcessAlive(child.pid)) process.kill(-child.pid, 'SIGKILL');
  });

  void it('kills a Chrome that has not exited after the grace window', async () => {
    const chrome = await stubbornChrome();
    const sent: string[] = [];
    const cdp = {
      send: (method: string) => {
        sent.push(method);
        return Promise.resolve({});
      },
      close: () => undefined,
    } as unknown as CDPConnection;

    const startedAt = Date.now();
    await releaseConnection({
      chrome,
      cdp,
      external: false,
      log: silentLog,
      notify: () => undefined,
      cancelledStart: true,
    });
    await terminateChrome(chrome, silentLog, { cancelledStart: true });
    const tookMs = Date.now() - startedAt;

    assert.deepEqual(sent, ['Browser.close']);
    assert.equal(isProcessAlive(chrome.pid), false, 'Chrome must be dead');
    assert.ok(tookMs < CANCELLED_TEARDOWN_MAX_MS, `teardown took ${tookMs} ms`);
  });
});
