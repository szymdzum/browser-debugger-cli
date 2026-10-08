/**
 * Error handling smoke tests.
 *
 * Tests error paths and user-facing error messages.
 * WHY: Errors are high-risk areas - tests ensure helpful messages and proper exit codes.
 */

import * as assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import { cleanupAllSessions } from '@/__testutils__/daemonHelpers.js';
import { getFreePort } from '@/__testutils__/fixtureServer.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('Error Handling Smoke Tests', () => {
  let allocatedPort: number;

  beforeEach(async () => {
    allocatedPort = await getFreePort();
  });

  afterEach(async () => {
    await cleanupAllSessions();
  });

  void it('should fail with helpful message when daemon not running', async () => {
    // Try to peek without daemon running
    // Note: peek auto-starts daemon, so it returns 83 after starting daemon
    const result = await runCommand('peek', [], { timeout: 5000 });

    // Should fail with resource not found (no session)
    assert.equal(result.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);

    // Should provide helpful error message about no session
    assert.ok(/no.*session|session.*not.*found/i.test(result.stderr));
  });

  void it('should fail with helpful message when trying to stop without session', async () => {
    // Try to stop without session
    const result = await runCommand('stop', [], { timeout: 5000 });

    // Should fail
    assert.notEqual(result.exitCode, 0);

    assert.match(result.stderr, /No active session/);
  });

  // REMOVED: Flaky test "should handle daemon crash during session"
  // Reason: Intermittent failures in CI due to timing/race conditions
  // The test passes locally but fails in CI when checking if daemon is still running
  // TODO: Re-enable with better synchronization/retry logic

  void it('should provide helpful error when Chrome fails to launch', async () => {
    // Try to start with invalid Chrome path and unique port
    const result = await runCommand(
      'http://127.0.0.1:9/',
      ['--port', allocatedPort.toString(), '--headless'],
      {
        timeout: 60000,
        env: {
          CHROME_PATH: '/nonexistent/chrome',
        },
      }
    );

    // Should fail (exit code 104 is acceptable for worker errors)
    assert.notEqual(result.exitCode, 0);

    // Should provide helpful error message mentioning Chrome
    assert.ok(/chrome|browser|launch|binary/i.test(result.stderr));
  });

  /**
   * Both commands fail in validation, about 0.5 s each with process start;
   * the 15 s bound only fails a start that went on to spawn a daemon and
   * Chrome and wait for them.
   */
  void it('refuses a session dir or profile that cannot hold a directory, at once', async () => {
    const started = Date.now();
    const sessionDir = await runCommand('http://127.0.0.1:9/', ['--headless'], {
      env: { BDG_SESSION_DIR: '/proc/bdg-smoke' },
    });
    assert.equal(sessionDir.exitCode, EXIT_CODES.SESSION_FILE_ERROR);
    assert.match(sessionDir.stderr, /\/proc is a pseudo-filesystem/);
    const profile = await runCommand('http://127.0.0.1:9/', [
      '--headless',
      '--user-data-dir',
      '/proc/bdg-smoke/profile',
    ]);
    assert.equal(profile.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(
      profile.stderr,
      /Invalid --user-data-dir "\/proc\/bdg-smoke\/profile": \/proc is a pseudo-filesystem/
    );
    assert.ok(Date.now() - started < 15000, 'both fail before anything is spawned');
    const status = await runCommand('status', []);
    assert.equal(status.exitCode, 0, 'no daemon was left behind');
  });

  // REMOVED: Flaky test "should cleanup stale sessions automatically"
  // Reason: Intermittent failures in CI due to timing/race conditions
  // The test passes locally but fails in CI when processes don't fully terminate
  // within the 2-second wait window, causing the new daemon to encounter:
  // - Port not fully released
  // - Orphaned worker detection/cleanup race conditions
  // - File system cleanup delays
  // Similar to previously removed flaky tests (daemon crash, invalid URL)
  // TODO: Re-enable with more robust synchronization or longer delays if critical
});
