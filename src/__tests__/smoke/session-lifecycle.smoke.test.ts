/**
 * Session lifecycle smoke tests.
 *
 * Tests the complete user flow: start → collect data → peek → stop.
 * WHY: Highest-risk path with 0% coverage despite being critical user flow.
 */

import * as assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';

import { runCommand, runCommandJSON } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions, isDaemonRunning } from '@/__testutils__/daemonHelpers.js';
import {
  getFreePort,
  startFixtureServer,
  type FixtureServer,
} from '@/__testutils__/fixtureServer.js';
import { getSessionFilePath } from '@/session/paths.js';
import { readPidFromFile } from '@/session/pid.js';
import type { BdgOutput } from '@/types.js';

void describe('Session Lifecycle Smoke Tests', () => {
  let fixture: FixtureServer;
  let allocatedPort: number;

  before(async () => {
    fixture = await startFixtureServer();
  });

  after(async () => {
    await fixture.close();
  });

  beforeEach(async () => {
    allocatedPort = await getFreePort();
  });

  afterEach(async () => {
    await cleanupAllSessions();
  });

  /**
   * Start a headless session against the fixture page.
   *
   * @param url - URL to open (defaults to the fixture page)
   * @returns Command result
   */
  function startSession(url: string = fixture.url): ReturnType<typeof runCommand> {
    return runCommand(url, ['--port', allocatedPort.toString(), '--headless'], {
      timeout: 60000,
    });
  }

  void it('should start session and create daemon', async () => {
    const result = await startSession();

    assert.equal(result.exitCode, 0, `Start failed: ${result.stderr}`);
    assert.equal(await isDaemonRunning(), true);
    const lines = result.stderr.trim().split('\n');
    assert.ok(lines.length <= 8, `start output has ${lines.length} lines:\n${result.stderr}`);
    assert.match(result.stderr, /^Session Started\nTarget: http:\/\/127\.0\.0\.1:\d+\//m);
    assert.match(result.stderr, /^Next: bdg dom layout .*bdg dom screenshot/m);
    assert.match(result.stderr, /^More: bdg --help/m);
  });

  void it('should provide data via peek before stop', async () => {
    const startResult = await startSession();
    assert.equal(startResult.exitCode, 0, `Session start failed: ${startResult.stderr}`);

    const peekResult = await runCommandJSON<BdgOutput>('peek', ['--json']);
    assert.ok(peekResult, 'Peek should return data before stop');
    assert.ok('version' in peekResult);
    assert.ok('data' in peekResult);

    const stopResult = await runCommand('stop', [], { timeout: 60000 });
    assert.equal(stopResult.exitCode, 0, `Stop failed: ${stopResult.stderr}`);
  });

  void it('should cleanup daemon on stop', async () => {
    const startResult = await startSession();
    assert.equal(startResult.exitCode, 0, `Session start failed: ${startResult.stderr}`);

    const stopResult = await runCommand('stop', [], { timeout: 60000 });
    assert.equal(stopResult.exitCode, 0, `Stop failed: ${stopResult.stderr}`);

    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await isDaemonRunning(), false);
  });

  void it('should handle concurrent session attempts gracefully', async () => {
    const firstResult = await startSession();
    assert.equal(firstResult.exitCode, 0, `First session start failed: ${firstResult.stderr}`);

    const secondResult = await startSession(`${fixture.url}other`);

    assert.notEqual(secondResult.exitCode, 0);
    assert.ok(
      /daemon|already|session/i.test(secondResult.stderr),
      `Expected error about existing session, got: ${secondResult.stderr}`
    );
    assert.equal(await isDaemonRunning(), true);
  });

  void it('starts a new session right after a stop, once the old one has ended', async () => {
    assert.equal((await startSession()).exitCode, 0);

    const stopping = runCommand('stop', [], { timeout: 60000 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const restarted = await startSession();
    await stopping;

    assert.equal(restarted.exitCode, 0, `Restart failed: ${restarted.stdout}${restarted.stderr}`);
    assert.equal(await isDaemonRunning(), true);
  });

  void it('reports a frozen session quickly instead of waiting 45 s', async () => {
    assert.equal((await startSession()).exitCode, 0);
    const daemonPid = readPidFromFile(getSessionFilePath('DAEMON_PID'));
    assert.ok(daemonPid, 'daemon pid file');

    process.kill(daemonPid, 'SIGSTOP');
    try {
      const started = Date.now();
      const status = await runCommand('status', ['--json'], { timeout: 30000 });
      assert.equal(status.exitCode, 102);
      assert.match(status.stdout, /did not respond/);
      assert.ok(Date.now() - started < 20000, 'answered within the quick timeout');
    } finally {
      process.kill(daemonPid, 'SIGCONT');
    }
  });
});
