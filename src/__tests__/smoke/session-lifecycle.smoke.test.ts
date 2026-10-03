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
});
