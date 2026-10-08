/**
 * A Chrome that is alive but does not open its debugging port within
 * chrome-launcher's readiness budget is a slow start, not a port conflict or
 * a crash (#523): the error says so, and the Chrome is still killed.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { getFreePort } from '@/__testutils__/fixtureServer.js';
import type { ChromeDiagnostics } from '@/connection/diagnostics.js';
import { ChromeLaunchError } from '@/connection/errors.js';
import { launchChrome, launchFailedError } from '@/connection/launcher.js';
import { formatChromeIssue } from '@/ui/messages/chrome.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-slow-start-'));
const silentLogger = { info: (): void => {}, debug: (): void => {} };
const FOUND: ChromeDiagnostics = {
  defaultPath: '/opt/chrome',
  installations: ['/opt/chrome'],
  installationCount: 1,
};

after(() => fs.rmSync(root, { recursive: true, force: true }));

/**
 * Write a stand-in Chrome that stays alive but never opens its debugging port.
 *
 * @param dir - Directory for the script
 * @returns Path of the script
 */
function writeHungChrome(dir: string): string {
  const script = path.join(dir, 'hung-chrome');
  fs.writeFileSync(script, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, {
    mode: 0o755,
  });
  return script;
}

/**
 * Whether a process exists.
 *
 * @param pid - Process ID
 * @returns True while the process exists
 */
function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait until a process is gone.
 *
 * @param pid - Process ID
 * @returns True if it was gone within 3 s
 */
async function waitForGone(pid: number): Promise<boolean> {
  const deadline = Date.now() + 3000;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return !processExists(pid);
}

/**
 * chrome-launcher's rejection when nothing answers on the port.
 *
 * @param port - Debugging port
 * @returns The connection error
 */
function connectionRefused(port: number): NodeJS.ErrnoException {
  return Object.assign(new Error(`connect ECONNREFUSED 127.0.0.1:${port}`), {
    code: 'ECONNREFUSED',
  });
}

void describe('launchChrome when Chrome does not open its port in time', () => {
  void it('says Chrome started but did not open the port, and kills it', async () => {
    const dir = fs.mkdtempSync(path.join(root, 'run-'));
    const userDataDir = path.join(dir, 'profile');
    fs.mkdirSync(userDataDir);
    const port = await getFreePort();

    const launch = launchChrome({
      port,
      userDataDir,
      headless: true,
      chromePath: writeHungChrome(dir),
      logger: silentLogger,
      connectionPollInterval: 50,
      maxConnectionRetries: 10,
    });

    await assert.rejects(launch, (error: unknown) => {
      assert.ok(error instanceof ChromeLaunchError);
      assert.equal(error.issue?.code, 'CHROME_PORT_NOT_OPENED');
      const pid = Number(fs.readFileSync(path.join(userDataDir, 'chrome.pid'), 'utf8'));
      assert.equal(
        error.message,
        `Chrome started (pid ${pid}) but did not open its debugging port ${port} within 0.5 s`
      );
      return true;
    });
    const pid = Number(fs.readFileSync(path.join(userDataDir, 'chrome.pid'), 'utf8'));
    assert.equal(await waitForGone(pid), true, `Chrome ${pid} must not outlive the launch`);
  });
});

void describe('launchFailedError', () => {
  void it('reports a slow start when Chrome is still alive', () => {
    const error = launchFailedError(connectionRefused(9222), {
      port: 9222,
      pid: 4242,
      chromeAlive: true,
      readyBudgetMs: 25000,
    });
    assert.equal(error.issue?.code, 'CHROME_PORT_NOT_OPENED');
    const text = formatChromeIssue(error.issue, () => FOUND);
    assert.match(
      text,
      /^Chrome started \(pid 4242\) but did not open its debugging port 9222 within 25 s\n/
    );
    assert.match(text, /a first start on a cold machine can be slow/);
    assert.match(text, /bdg cleanup/);
    assert.doesNotMatch(text, /Possible causes|conflict|permissions|binary not found/i);
  });

  void it('keeps the generic launch failure when Chrome is gone', () => {
    const error = launchFailedError(connectionRefused(9222), {
      port: 9222,
      pid: 4242,
      chromeAlive: false,
      readyBudgetMs: 25000,
    });
    assert.equal(error.issue?.code, 'CHROME_LAUNCH_FAILED');
    assert.equal(error.message, 'Failed to launch Chrome: connect ECONNREFUSED 127.0.0.1:9222');
    const text = formatChromeIssue(error.issue, () => FOUND);
    assert.match(text, /Possible causes:/);
    assert.match(text, /Port 9222 conflict/);
  });

  void it('keeps the generic launch failure for other errors of a live Chrome', () => {
    const error = launchFailedError(new Error('spawn EACCES'), {
      port: 9222,
      pid: 4242,
      chromeAlive: true,
      readyBudgetMs: 25000,
    });
    assert.equal(error.issue?.code, 'CHROME_LAUNCH_FAILED');
  });
});
