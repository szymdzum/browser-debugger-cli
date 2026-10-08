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
import { getSessionFilePath } from '@/session/paths.js';
import { readPidFromFile } from '@/session/pid.js';

/** The daemon exits after Chrome's teardown (up to 5 s for Chrome alone) */
const DAEMON_EXIT_TIMEOUT_MS = 15000;

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

/**
 * Write a stand-in Chrome that opens its debugging port and announces it like
 * Chrome, but never answers HTTP requests on it (a Chrome that is very slow to
 * start). It writes its PID to `readyFile` once it listens.
 *
 * @param dir - Directory for the script
 * @param readyFile - File the stand-in writes its PID to
 * @returns Path of the executable script
 */
function writeSilentChrome(dir: string, readyFile: string): string {
  const script = path.join(dir, 'silent-chrome');
  const source = [
    `#!${process.execPath}`,
    "const fs = require('node:fs');",
    "const net = require('node:net');",
    "const flag = process.argv.find((arg) => arg.startsWith('--remote-debugging-port='));",
    "const port = Number(flag.split('=')[1]);",
    'net.createServer(() => {}).listen(port, "127.0.0.1", () => {',
    '  process.stderr.write(`DevTools listening on ws://127.0.0.1:${port}/devtools/browser/silent\n`);',
    `  fs.writeFileSync(${JSON.stringify(readyFile)}, String(process.pid));`,
    '});',
  ].join('\n');
  fs.writeFileSync(script, source, { mode: 0o755 });
  return script;
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
    assert.notEqual(startResult.exitCode, 0, 'interrupted start must not report success');
    assert.equal(await waitForProcessExit(chromePid), true, 'Chrome must exit');
    assert.equal(await isDaemonRunning(), false);
    assert.equal(fs.existsSync(getSessionFilePath('CHROME_PID')), false);
  });

  void it('bdg stop while a slow Chrome does not answer yet ends the start at once', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bdg-silent-chrome-'));
    const readyFile = path.join(dir, 'ready');
    try {
      const port = await getFreePort();
      const start = runCommand(`${fixture.url}slow`, ['--port', String(port), '--headless'], {
        timeout: 60000,
        env: { CHROME_PATH: writeSilentChrome(dir, readyFile) },
      });
      const deadline = Date.now() + 20000;
      while (!fs.existsSync(readyFile) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const chromePid = Number(fs.readFileSync(readyFile, 'utf8'));
      await new Promise((resolve) => setTimeout(resolve, 500));

      const stoppedAt = Date.now();
      const stop = await runCommand('stop', [], { timeout: 30000 });
      assert.equal(stop.exitCode, 0, `Stop failed: ${stop.stderr}`);
      const startResult = await start;
      const tookMs = Date.now() - stoppedAt;

      assert.notEqual(startResult.exitCode, 0, 'interrupted start must not report success');
      assert.ok(tookMs < 5000, `start ended ${tookMs} ms after bdg stop`);
      assert.equal(await waitForProcessExit(chromePid), true, 'Chrome must exit');
      assert.equal(await isDaemonRunning(), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  void it('SIGTERM to the daemon during startup tears down Chrome', async () => {
    const start = await startSlowSession();
    const daemonPid = await waitForPid('DAEMON_PID');
    const chromePid = await waitForPid('CHROME_PID');

    process.kill(daemonPid, 'SIGTERM');

    await start.result;
    assert.equal(await waitForProcessExit(daemonPid), true, 'daemon must exit');
    assert.equal(await waitForProcessExit(chromePid), true, 'Chrome must exit');
  });

  void it('Ctrl-C on the start command during startup leaves no session', async () => {
    const ctrlC = new AbortController();
    const start = await startSlowSession(ctrlC.signal);
    const daemonPid = await waitForPid('DAEMON_PID');
    const chromePid = await waitForPid('CHROME_PID');

    ctrlC.abort();

    assert.equal((await start.result).exitCode, 130);
    assert.equal(await waitForProcessExit(chromePid), true, 'Chrome must exit');
    assert.equal(await isDaemonRunning(), false, 'no session may answer');
    assert.equal(
      await waitForProcessExit(daemonPid, DAEMON_EXIT_TIMEOUT_MS),
      true,
      'daemon must exit after its teardown'
    );
  });
});
