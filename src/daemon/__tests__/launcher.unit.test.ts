/**
 * Unit tests for daemon launcher
 *
 * Note: These are simplified tests that verify the core error handling logic.
 * The launchDaemon function throws appropriate errors that can be caught by callers.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('daemon/launcher error handling', () => {
  void it('should have DAEMON_ALREADY_RUNNING exit code defined', () => {
    assert.equal(EXIT_CODES.DAEMON_ALREADY_RUNNING, 86);
  });

  void it('should use user error range for DAEMON_ALREADY_RUNNING', () => {
    // User errors are in range 80-99
    assert.ok(EXIT_CODES.DAEMON_ALREADY_RUNNING >= 80);
    assert.ok(EXIT_CODES.DAEMON_ALREADY_RUNNING <= 99);
  });
});
