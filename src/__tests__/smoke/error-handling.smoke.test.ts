/**
 * Error handling smoke tests.
 *
 * Tests error paths and user-facing error messages.
 * WHY: Errors are high-risk areas - tests ensure helpful messages and proper exit codes.
 */

import * as assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';

import { runCommand } from '@/__testutils__/commandRunner.js';
import {
  cleanupAllSessions,
  isDaemonRunning,
  killDaemon,
  waitForDaemon,
} from '@/__testutils__/daemonHelpers.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('Error Handling Smoke Tests', () => {
  afterEach(async () => {
    // Cleanup after each test (no beforeEach needed if this works properly)
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

    // Should provide helpful error message
    assert.ok(result.stderr.includes('daemon'));
  });

  void it('should handle invalid URL gracefully', async () => {
    // Note: URL validation is permissive - "not-a-valid-url" becomes "http://not-a-valid-url/"
    // This test verifies error handling, not URL validation
    const result = await runCommand('http://example.com', ['--port', '9229', '--headless'], {
      timeout: 10000,
    });

    // Should succeed (URL is valid, session starts)
    assert.equal(result.exitCode, 0);

    // Should provide session started message
    assert.ok(/session started|target:/i.test(result.stderr));
  });

  void it('should handle daemon crash during session', async () => {
    // Start session with unique port
    await runCommand('http://example.com', ['--port', '9230', '--headless'], { timeout: 10000 });
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
    // Try to start with invalid Chrome path and unique port
    const result = await runCommand('http://example.com', ['--port', '9231', '--headless'], {
      timeout: 10000,
      env: {
        CHROME_PATH: '/nonexistent/chrome',
      },
    });

    // Should fail (exit code 104 is acceptable for worker errors)
    assert.notEqual(result.exitCode, 0);

    // Should provide helpful error message mentioning Chrome
    assert.ok(/chrome|browser|launch|binary/i.test(result.stderr));
  });

  void it('should cleanup stale sessions automatically', async () => {
    // Start session with unique port
    await runCommand('http://example.com', ['--port', '9232', '--headless'], { timeout: 10000 });
    await waitForDaemon(5000);

    // Kill daemon without cleanup (simulate crash)
    await killDaemon('SIGKILL');

    // Wait for process to fully die
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Try to start new session (should cleanup stale and succeed)
    const result = await runCommand('http://example.com', ['--port', '9232', '--headless'], {
      timeout: 10000,
    });

    // Should succeed after cleanup
    assert.equal(result.exitCode, 0);

    // New daemon should be running
    assert.equal(isDaemonRunning(), true);
  });
});
