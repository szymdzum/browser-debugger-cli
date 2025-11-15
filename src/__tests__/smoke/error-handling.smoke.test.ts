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

  // REMOVED: Flaky test "should handle daemon crash during session"
  // Reason: Intermittent failures in CI due to timing/race conditions
  // The test passes locally but fails in CI when checking if daemon is still running
  // TODO: Re-enable with better synchronization/retry logic

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

    // Kill Chrome on port 9232 (simulating what happens when daemon crashes)
    try {
      const { execSync } = await import('child_process');
      execSync(`lsof -ti:9232 | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
    } catch {
      // Ignore errors if no process on port
    }

    // Wait for processes to fully die and port to be released
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Try to start new session (should cleanup stale and succeed)
    const result = await runCommand('http://example.com', ['--port', '9232', '--headless'], {
      timeout: 10000,
    });

    // Should succeed after cleanup
    if (result.exitCode !== 0) {
      console.error('Exit code:', result.exitCode);
      console.error('Stderr:', result.stderr);
      console.error('Stdout:', result.stdout);
    }
    assert.equal(result.exitCode, 0);

    // New daemon should be running
    assert.equal(isDaemonRunning(), true);
  });
});
