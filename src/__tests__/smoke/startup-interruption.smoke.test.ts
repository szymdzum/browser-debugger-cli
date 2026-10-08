/**
 * Startup interruption smoke tests.
 *
 * A session that is stopped (by `bdg stop`, a signal to the daemon, or Ctrl-C
 * on the starting command) while it is still launching must not leave Chrome
 * or the daemon running.
 */

import * as fs from 'fs';
import * as assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';

import { runCommand, type CommandResult } from '@/__testutils__/commandRunner.js';
import {
  cleanupAllSessions,
  isDaemonRunning,
  waitForProcessExit,
} from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { writeSilentChrome } from '@/__testutils__/silentChrome.js';
import { getSessionFilePath } from '@/session/paths.js';
import { readPidFromFile } from '@/session/pid.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** What a start stopped by `bdg stop` reports */
const START_CANCELLED = /The start was cancelled: the session was stopped while it was starting/;

/**
 * The daemon exits after Chrome's teardown (up to 5 s for Chrome alone, then
 * SIGKILL); also the wait for Chrome itself once an interrupted start has
 * returned, since the start stops waiting for its daemon after 3 s.
 */
const DAEMON_EXIT_TIMEOUT_MS = 15000;

/**
 * How soon an interrupted start must end while bdg waits for a silent
 * Chrome's `/json/version` answer. Without the abort it would wait out the
 * 10 s launch verification; with it the start ends within about 1 s (on the
 * `bdg stop` path that includes starting the `bdg stop` process).
 */
const INTERRUPTED_START_MAX_MS = 5000;

/**
 * Wait until a file exists.
 *
 * @param file - File to wait for
 * @param what - What its absence means, for the error
 */
async function waitForFile(file: string, what: string): Promise<void> {
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(what);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/**
 * Wait until a PID file exists and holds a PID.
 *
 * @param file - Session file holding the PID
 * @returns The PID
 */
async function waitForPid(file: 'CHROME_PID' | 'DAEMON_PID'): Promise<number> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const pid = readPidFromFile(getSessionFilePath(file));
    if (pid) return pid;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${file} never appeared`);
}

void describe('Startup interruption', () => {
  let fixture: FixtureServer;

  before(async () => {
    await cleanupAllSessions();
    fixture = await startFixtureServer();
  });

  after(async () => {
    await fixture.close();
  });

  afterEach(async () => {
    await cleanupAllSessions();
  });

  /**
   * Start a session against the slow page without waiting for it.
   *
   * `/slow` answers 8 s after Chrome requests it, which is after Chrome is up;
   * the tests interrupt the start as soon as Chrome's PID file appears (about
   * 1 s for a `bdg stop` process to reach the daemon), so the start is still
   * waiting for the page with 7 s to spare.
   *
   * @param interrupt - Sends SIGINT to the start command when aborted
   * @returns Holder for the pending start command (not awaited)
   */
  async function startSlowSession(
    interrupt?: AbortSignal
  ): Promise<{ result: Promise<CommandResult> }> {
    const port = await getFreePort();
    const result = runCommand(`${fixture.url}slow`, ['--port', String(port), '--headless'], {
      timeout: 60000,
      ...(interrupt && { interrupt }),
    });
    return { result };
  }

  void it('bdg stop during startup tears down Chrome and the daemon', async () => {
    const start = await startSlowSession();
    const chromePid = await waitForPid('CHROME_PID');

    const stop = await runCommand('stop', [], { timeout: 30000 });
    assert.equal(stop.exitCode, 0, `Stop failed: ${stop.stderr}`);

    const startResult = await start.result;
    assert.equal(startResult.exitCode, EXIT_CODES.RESOURCE_CONFLICT, startResult.stderr);
    assert.match(startResult.stderr, START_CANCELLED);
    assert.equal(await waitForProcessExit(chromePid), true, 'Chrome must exit');
    assert.equal(await isDaemonRunning(), false);
    assert.equal(fs.existsSync(getSessionFilePath('CHROME_PID')), false);
  });

  /**
   * Start a session whose Chrome never answers (see {@link writeSilentChrome}),
   * wait until bdg has asked that Chrome for `/json/version` (the request is
   * then pending, and stays so), and interrupt the start.
   *
   * @param interrupt - Interrupts the start (`bdg stop`, or Ctrl-C via the controller)
   * @returns The start command's result, how long it took to end after the
   *   interruption, and the stand-in Chrome's PID
   */
  async function interruptSilentChromeStart(
    interrupt: (ctrlC: AbortController) => Promise<void>
  ): Promise<{ result: CommandResult; tookMs: number; chromePid: number }> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-silent-chrome-'));
    const readyFile = path.join(dir, 'ready');
    const requestFile = path.join(dir, 'requested');
    try {
      const ctrlC = new AbortController();
      const port = await getFreePort();
      const start = runCommand(`${fixture.url}slow`, ['--port', String(port), '--headless'], {
        timeout: 60000,
        env: { CHROME_PATH: writeSilentChrome(dir, readyFile, requestFile) },
        interrupt: ctrlC.signal,
      });
      await waitForFile(requestFile, 'bdg never asked the silent Chrome for /json/version');
      const chromePid = Number(fs.readFileSync(readyFile, 'utf8'));
      const interruptedAt = Date.now();
      await interrupt(ctrlC);
      const result = await start;
      return { result, tookMs: Date.now() - interruptedAt, chromePid };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  void it('bdg stop while a slow Chrome does not answer yet ends the start at once', async () => {
    const { result, tookMs, chromePid } = await interruptSilentChromeStart(async () => {
      const stop = await runCommand('stop', [], { timeout: 30000 });
      assert.equal(stop.exitCode, 0, `Stop failed: ${stop.stderr}`);
    });

    assert.equal(result.exitCode, EXIT_CODES.RESOURCE_CONFLICT, result.stderr);
    assert.match(result.stderr, START_CANCELLED);
    assert.ok(tookMs < INTERRUPTED_START_MAX_MS, `start ended ${tookMs} ms after bdg stop`);
    assert.equal(await waitForProcessExit(chromePid), true, 'Chrome must exit');
    assert.equal(await isDaemonRunning(), false);
  });

  void it('Ctrl-C while a slow Chrome does not answer yet ends the start at once', async () => {
    const { result, tookMs, chromePid } = await interruptSilentChromeStart((ctrlC) => {
      ctrlC.abort();
      return Promise.resolve();
    });

    assert.equal(result.exitCode, 130);
    assert.ok(tookMs < INTERRUPTED_START_MAX_MS, `start ended ${tookMs} ms after Ctrl-C`);
    assert.equal(await waitForProcessExit(chromePid), true, 'Chrome must exit');
    assert.equal(await isDaemonRunning(), false, 'no session may answer');
  });

  void it('SIGTERM to the daemon during startup tears down Chrome', async () => {
    const start = await startSlowSession();
    const daemonPid = await waitForPid('DAEMON_PID');
    const chromePid = await waitForPid('CHROME_PID');

    process.kill(daemonPid, 'SIGTERM');

    await start.result;
    assert.equal(
      await waitForProcessExit(daemonPid, DAEMON_EXIT_TIMEOUT_MS),
      true,
      'daemon must exit'
    );
    assert.equal(
      await waitForProcessExit(chromePid, DAEMON_EXIT_TIMEOUT_MS),
      true,
      'Chrome must exit'
    );
  });

  void it('Ctrl-C on the start command during startup leaves no session', async () => {
    const ctrlC = new AbortController();
    const start = await startSlowSession(ctrlC.signal);
    const daemonPid = await waitForPid('DAEMON_PID');
    const chromePid = await waitForPid('CHROME_PID');

    ctrlC.abort();

    assert.equal((await start.result).exitCode, 130);
    assert.equal(await isDaemonRunning(), false, 'no session may answer once the start exited');
    assert.equal(
      await waitForProcessExit(chromePid, DAEMON_EXIT_TIMEOUT_MS),
      true,
      'Chrome must exit'
    );
    assert.equal(
      await waitForProcessExit(daemonPid, DAEMON_EXIT_TIMEOUT_MS),
      true,
      'daemon must exit after its teardown'
    );
  });
});
