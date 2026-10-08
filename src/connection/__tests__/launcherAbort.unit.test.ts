/**
 * A launch aborted because the session was stopped (#474) must never leave a
 * Chrome running, whenever the abort arrives: before chrome-launcher spawned
 * Chrome, while it spawns it, or while bdg waits for it to answer.
 */

import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, describe, it } from 'node:test';

import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { writeSilentChrome } from '@/__testutils__/silentChrome.js';
import { ChromeLaunchError } from '@/connection/errors.js';
import { launchChrome } from '@/connection/launcher.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-launch-abort-'));
const silentLogger = { info: (): void => {}, debug: (): void => {} };

after(() => fs.rmSync(root, { recursive: true, force: true }));

/**
 * Whether a process exists (a reaped zombie does not).
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
 * Start a launch of the stand-in Chrome in a fresh profile.
 *
 * @param signal - The launch's abort signal
 * @returns The launch and the file chrome-launcher writes the spawned PID to
 */
async function launchSilentChrome(
  signal: AbortSignal
): Promise<{ launch: Promise<unknown>; pidFile: string }> {
  const dir = fs.mkdtempSync(path.join(root, 'run-'));
  const userDataDir = path.join(dir, 'profile');
  fs.mkdirSync(userDataDir);
  const launch = launchChrome({
    port: await getFreePort(),
    userDataDir,
    headless: true,
    chromePath: writeSilentChrome(dir, path.join(dir, 'ready')),
    logger: silentLogger,
    maxConnectionRetries: 20,
    signal,
  });
  return { launch, pidFile: path.join(userDataDir, 'chrome.pid') };
}

/**
 * Assert that a launch failed as aborted.
 *
 * @param launch - The launch
 */
async function assertAborted(launch: Promise<unknown>): Promise<void> {
  await assert.rejects(launch, (error: unknown) => {
    assert.ok(error instanceof ChromeLaunchError);
    assert.match(error.message, /aborted/);
    return true;
  });
}

void describe('launchChrome aborted by a stop', () => {
  void it('spawns no Chrome when the session was already stopped', async () => {
    const { launch, pidFile } = await launchSilentChrome(AbortSignal.abort());
    await assertAborted(launch);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(fs.existsSync(pidFile), false, 'no Chrome may be spawned');
  });

  for (const afterMs of [0, 1, 2, 5, 10, 20, 50]) {
    void it(`leaves no Chrome running when stopped ${afterMs} ms into the launch`, async () => {
      const stop = new AbortController();
      const { launch, pidFile } = await launchSilentChrome(stop.signal);
      setTimeout(() => stop.abort(), afterMs);
      await assertAborted(launch);
      await new Promise((resolve) => setTimeout(resolve, 300));
      if (!fs.existsSync(pidFile)) return;
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      assert.equal(await waitForGone(pid), true, `Chrome ${pid} must not outlive the launch`);
    });
  }

  void it('leaves no Chrome running when stopped while waiting for its answer', async () => {
    const stop = new AbortController();
    const { launch, pidFile } = await launchSilentChrome(stop.signal);
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(pidFile) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    stop.abort();
    await assertAborted(launch);
    assert.equal(await waitForGone(pid), true, `Chrome ${pid} must not outlive the launch`);
  });
});
