/**
 * Session lifecycle smoke tests.
 *
 * Tests the complete user flow: start → collect data → stop → verify output.
 * WHY: Highest-risk path with 0% coverage despite being critical user flow.
 */

import * as assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';

import { runCommand, runCommandJSON } from '@/__testutils__/commandRunner.js';
import {
  cleanupAllSessions,
  isDaemonRunning,
  isSessionActive,
  readSessionOutput,
  waitForDaemon,
} from '@/__testutils__/daemonHelpers.js';

void describe('Session Lifecycle Smoke Tests', () => {
  afterEach(async () => {
    // Cleanup after each test (no beforeEach needed if this works properly)
    await cleanupAllSessions();
  });

  void it('should start session and create daemon', async () => {
    // Start session with a simple URL using a unique port to avoid conflicts
    const result = await runCommand('http://example.com', ['--port', '9223', '--headless'], {
      timeout: 15000, // Increased from 10s to handle slow CI runners
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
    const startResult = await runCommand('http://example.com', ['--port', '9224', '--headless'], {
      timeout: 10000,
    });
    assert.equal(startResult.exitCode, 0, `Session start failed: ${startResult.stderr}`);

    // Wait for daemon to be ready
    await waitForDaemon(5000);

    // Give Chrome time to navigate and collect some data
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Peek at collected data
    const peekResult = await runCommandJSON<{ preview: Record<string, unknown> }>('peek', [
      '--json',
    ]);

    // Should have collected some data
    assert.ok(peekResult);
    assert.ok(typeof peekResult === 'object');
    assert.ok('preview' in peekResult);
    assert.ok('data' in peekResult.preview);

    // Stop session to clean up
    const stopResult = await runCommand('stop', [], { timeout: 10000 });
    assert.equal(stopResult.exitCode, 0, `Stop failed: ${stopResult.stderr}`);
  });

  void it('should write output on stop', async () => {
    // Start session with unique port
    const startResult = await runCommand('http://example.com', ['--port', '9225', '--headless'], {
      timeout: 10000,
    });
    assert.equal(startResult.exitCode, 0, `Session start failed: ${startResult.stderr}`);
    await waitForDaemon(5000);

    // Give Chrome time to collect data
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Stop session
    const stopResult = await runCommand('stop', [], { timeout: 10000 });

    // Should succeed
    assert.equal(stopResult.exitCode, 0, `Stop failed: ${stopResult.stderr}`);

    // Give filesystem time to write the file (increased for test stability)
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Output file should exist
    const output = readSessionOutput();
    assert.ok(output, 'Session output file should exist after stop');
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
    await runCommand('http://example.com', ['--port', '9226', '--headless'], { timeout: 10000 });
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
    const firstResult = await runCommand('http://example.com', ['--port', '9227', '--headless'], {
      timeout: 10000,
    });
    assert.equal(firstResult.exitCode, 0, `First session start failed: ${firstResult.stderr}`);
    await waitForDaemon(5000);

    // Try to start second session (should fail)
    const secondResult = await runCommand('http://another.com', ['--port', '9228', '--headless'], {
      timeout: 10000,
    });

    // Should fail with daemon already running error
    assert.notEqual(secondResult.exitCode, 0);
    assert.ok(
      secondResult.stderr.includes('daemon') || secondResult.stderr.includes('already'),
      `Expected error about daemon, got: ${secondResult.stderr}`
    );

    // First session should still be running
    assert.equal(isDaemonRunning(), true);
  });
});
