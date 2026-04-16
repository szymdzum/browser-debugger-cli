import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { IPCErrorCode } from '@/ipc/index.js';
import {
  getExitCodeForIPCError,
  getExitCodeForConnectionError,
  isDaemonNotRunningError,
} from '@/utils/errorMapping.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('getExitCodeForIPCError', () => {
  const cases: Array<[IPCErrorCode | undefined, number, string]> = [
    [IPCErrorCode.NO_SESSION, EXIT_CODES.RESOURCE_NOT_FOUND, 'NO_SESSION → RESOURCE_NOT_FOUND'],
    [
      IPCErrorCode.SESSION_ALREADY_RUNNING,
      EXIT_CODES.RESOURCE_ALREADY_EXISTS,
      'SESSION_ALREADY_RUNNING → RESOURCE_ALREADY_EXISTS',
    ],
    [
      IPCErrorCode.SESSION_TARGET_MISMATCH,
      EXIT_CODES.RESOURCE_CONFLICT,
      'SESSION_TARGET_MISMATCH → RESOURCE_CONFLICT (not RESOURCE_BUSY — conflicting intent, not retry-able)',
    ],
    [
      IPCErrorCode.CHROME_LAUNCH_FAILED,
      EXIT_CODES.CHROME_LAUNCH_FAILURE,
      'CHROME_LAUNCH_FAILED → CHROME_LAUNCH_FAILURE',
    ],
    [IPCErrorCode.CDP_TIMEOUT, EXIT_CODES.CDP_TIMEOUT, 'CDP_TIMEOUT → CDP_TIMEOUT'],
    [
      IPCErrorCode.SESSION_KILL_FAILED,
      EXIT_CODES.SESSION_FILE_ERROR,
      'SESSION_KILL_FAILED → SESSION_FILE_ERROR',
    ],
    [
      IPCErrorCode.WORKER_START_FAILED,
      EXIT_CODES.WORKER_START_FAILURE,
      'WORKER_START_FAILED → WORKER_START_FAILURE (was CDP_CONNECTION_FAILURE; worker crash is broader than CDP)',
    ],
    [IPCErrorCode.DAEMON_ERROR, EXIT_CODES.SOFTWARE_ERROR, 'DAEMON_ERROR → SOFTWARE_ERROR'],
    [undefined, EXIT_CODES.SOFTWARE_ERROR, 'undefined → SOFTWARE_ERROR fallback'],
  ];

  for (const [input, expected, label] of cases) {
    void it(label, () => {
      assert.equal(getExitCodeForIPCError(input), expected);
    });
  }
});

void describe('getExitCodeForConnectionError', () => {
  void it('maps ENOENT / ECONNREFUSED to RESOURCE_NOT_FOUND', () => {
    assert.equal(getExitCodeForConnectionError('ENOENT: socket'), EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.equal(getExitCodeForConnectionError('ECONNREFUSED'), EXIT_CODES.RESOURCE_NOT_FOUND);
  });

  void it('maps "no active session" to RESOURCE_NOT_FOUND', () => {
    assert.equal(
      getExitCodeForConnectionError('No active session found'),
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  });

  void it('maps timeout messages to CDP_TIMEOUT', () => {
    assert.equal(getExitCodeForConnectionError('Request timeout'), EXIT_CODES.CDP_TIMEOUT);
  });

  void it('falls back to SESSION_FILE_ERROR', () => {
    assert.equal(getExitCodeForConnectionError('Unknown failure'), EXIT_CODES.SESSION_FILE_ERROR);
  });
});

void describe('isDaemonNotRunningError', () => {
  void it('detects ENOENT / ECONNREFUSED', () => {
    assert.equal(isDaemonNotRunningError('ENOENT'), true);
    assert.equal(isDaemonNotRunningError('econnrefused'), true);
  });

  void it('returns false for unrelated errors', () => {
    assert.equal(isDaemonNotRunningError('Timeout'), false);
  });
});
