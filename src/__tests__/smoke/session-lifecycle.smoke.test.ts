/**
 * Session lifecycle smoke tests.
 *
 * Tests the complete user flow: start → collect data → stop → verify output.
 * WHY: Highest-risk path with 0% coverage despite being critical user flow.
 */

import * as assert from 'node:assert/strict';
import { describe, it, beforeEach, afterEach } from 'node:test';

import { runCommand, runCommandJSON } from '@/__testutils__/commandRunner.js';
import {
  cleanupAllSessions,
  isDaemonRunning,
  isSessionActive,
  readSessionOutput,
  waitForDaemon,
} from '@/__testutils__/daemonHelpers.js';

void describe('Session Lifecycle Smoke Tests', () => {
  beforeEach(async () => {
    // Ensure clean state before each test
    await cleanupAllSessions();
  });

  afterEach(async () => {
    // Cleanup after each test
    await cleanupAllSessions();
  });

  void it('should start session and create daemon', async () => {
    // Start session with a simple URL using a unique port to avoid conflicts
    const result = await runCommand('http://example.com', ['--port', '9223'], {
      timeout: 10000,
    });

    // Should succeed
    assert.equal(result.exitCode, 0);

    // Daemon should be running
    assert.equal(isDaemonRunning(), true);

    // Session should be active
    assert.equal(isSessionActive(), true);
  });

  void it('should collect data during session', async () => {
    // Start session with unique port
    await runCommand('http://example.com', ['--port', '9224'], { timeout: 10000 });

    // Wait for daemon to be ready
    await waitForDaemon(5000);

    // Give Chrome time to navigate and collect some data
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Peek at collected data
    const peekData = await runCommandJSON<Record<string, unknown>>('peek', ['--json']);

    // Should have collected some data
    assert.ok(peekData);
    assert.ok(typeof peekData === 'object');
    assert.ok('data' in peekData);
  });

  void it('should write output on stop', async () => {
    // Start session with unique port
    await runCommand('http://example.com', ['--port', '9225'], { timeout: 10000 });
    await waitForDaemon(5000);

    // Give Chrome time to collect data
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Stop session
    const stopResult = await runCommand('stop', [], { timeout: 10000 });

    // Should succeed
    assert.equal(stopResult.exitCode, 0);

    // Output file should exist
    const output = readSessionOutput();
    assert.ok(output);
    assert.ok(typeof output === 'object');

    // Output should have expected structure
    assert.ok('version' in output);
    assert.ok('success' in output);
    assert.equal((output as { success: boolean }).success, true);
    assert.ok('timestamp' in output);
    assert.ok('data' in output);
    assert.ok('target' in output);
  });

  void it('should cleanup daemon on stop', async () => {
    // Start session with unique port
    await runCommand('http://example.com', ['--port', '9226'], { timeout: 10000 });
    await waitForDaemon(5000);

    // Stop session
    await runCommand('stop', [], { timeout: 10000 });

    // Wait for cleanup
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Daemon should no longer be running
    assert.equal(isDaemonRunning(), false);

    // Session should no longer be active
    assert.equal(isSessionActive(), false);
  });

  void it('should handle concurrent session attempts gracefully', async () => {
    // Start first session with unique port
    await runCommand('http://example.com', ['--port', '9227'], { timeout: 10000 });
    await waitForDaemon(5000);

    // Try to start second session (should fail)
    const secondResult = await runCommand('http://another.com', ['--port', '9228'], {
      timeout: 10000,
    });

    // Should fail with daemon already running error
    assert.notEqual(secondResult.exitCode, 0);
    assert.ok(secondResult.stderr.includes('daemon'));

    // First session should still be running
    assert.equal(isDaemonRunning(), true);
  });
});
