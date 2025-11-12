/**
 * Error handling smoke tests.
 *
 * Tests error paths and user-facing error messages.
 * WHY: Errors are high-risk areas - tests ensure helpful messages and proper exit codes.
 */

import * as assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import {
  cleanupAllSessions,
  isDaemonRunning,
  killDaemon,
  waitForDaemon,
} from '@/__testutils__/daemonHelpers.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('Error Handling Smoke Tests', () => {
  beforeEach(async () => {
    await cleanupAllSessions();
  });

  afterEach(async () => {
    await cleanupAllSessions();
  });

  void it('should fail with helpful message when daemon not running', async () => {
    // Try to peek without daemon running
    const result = await runCommand('peek', [], { timeout: 5000 });

    // Should fail with resource not found
    assert.equal(result.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);

    // Should provide helpful error message
    assert.ok(result.stderr.includes('daemon'));
    assert.ok(/not running|not found|no session/i.test(result.stderr));
  });

  void it('should fail with helpful message when trying to stop without session', async () => {
    // Try to stop without session
    const result = await runCommand('stop', [], { timeout: 5000 });

    // Should fail
    assert.notEqual(result.exitCode, 0);

    // Should provide helpful error message
    assert.ok(result.stderr.includes('daemon'));
  });

  void it('should handle invalid URL gracefully', async () => {
    // Try to start with malformed URL
    const result = await runCommand('not-a-valid-url', [], {
      timeout: 10000,
    });

    // Should fail with invalid arguments
    assert.equal(result.exitCode, EXIT_CODES.INVALID_URL);

    // Should provide helpful error message
    assert.ok(/invalid|url|malformed/i.test(result.stderr));
  });

  void it('should handle daemon crash during session', async () => {
    // Start session
    await runCommand('http://example.com', [], { timeout: 10000 });
    await waitForDaemon(5000);

    // Kill daemon forcefully (simulate crash)
    await killDaemon('SIGKILL');

    // Wait for process to fully die
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Try to peek (should fail)
    const peekResult = await runCommand('peek', [], { timeout: 5000 });

    // Should fail
    assert.notEqual(peekResult.exitCode, 0);

    // Should provide helpful error message
    assert.ok(peekResult.stderr.includes('daemon'));

    // Daemon should not be running
    assert.equal(isDaemonRunning(), false);
  });

  void it('should provide helpful error when Chrome fails to launch', async () => {
    // Try to start with invalid Chrome path
    const result = await runCommand('http://example.com', [], {
      timeout: 10000,
      env: {
        CHROME_PATH: '/nonexistent/chrome',
      },
    });

    // Should fail with Chrome launch error
    assert.equal(result.exitCode, EXIT_CODES.CHROME_LAUNCH_FAILURE);

    // Should provide helpful error message
    assert.ok(/chrome|browser|launch|binary/i.test(result.stderr));
  });

  void it('should cleanup stale sessions automatically', async () => {
    // Start session
    await runCommand('http://example.com', [], { timeout: 10000 });
    await waitForDaemon(5000);

    // Kill daemon without cleanup (simulate crash)
    await killDaemon('SIGKILL');

    // Wait for process to fully die
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Try to start new session (should cleanup stale and succeed)
    const result = await runCommand('http://example.com', [], {
      timeout: 10000,
    });

    // Should succeed after cleanup
    assert.equal(result.exitCode, 0);

    // New daemon should be running
    assert.equal(isDaemonRunning(), true);
  });
});
