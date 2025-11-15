/**
 * Transport Error Formatting Unit Tests
 *
 * Tests error formatting behavior.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatConnectionError,
  formatEarlyCloseError,
  formatParseError,
  formatTimeoutError,
} from '@/ipc/transport/errors.js';

void describe('formatConnectionError', () => {
  void it('includes request name, socket path, and error details', () => {
    const error = new Error('Connection refused');
    const formatted = formatConnectionError('status', '/tmp/daemon.sock', error);

    assert.ok(formatted.message.includes('status'));
    assert.ok(formatted.message.includes('/tmp/daemon.sock'));
    assert.ok(formatted.message.includes('Connection refused'));
  });

  void it('includes error code when present', () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';

    const formatted = formatConnectionError('peek', '/tmp/daemon.sock', error);

    assert.ok(formatted.message.includes('ENOENT'));
  });

  void it('omits error code when not present', () => {
    const error = new Error('Generic error');
    const formatted = formatConnectionError('status', '/tmp/daemon.sock', error);

    assert.ok(!formatted.message.includes('Code:'));
  });
});

void describe('formatParseError', () => {
  void it('includes request name and error message', () => {
    const formatted = formatParseError('status', new SyntaxError('Unexpected token'));

    assert.ok(formatted.message.includes('status'));
    assert.ok(formatted.message.includes('Unexpected token'));
  });

  void it('handles non-Error objects', () => {
    const formatted = formatParseError('peek', 'string error');

    assert.ok(formatted.message.includes('peek'));
    assert.ok(formatted.message.includes('string error'));
  });
});

void describe('formatTimeoutError', () => {
  void it('includes request name and timeout in seconds', () => {
    const formatted = formatTimeoutError('status', 5000);

    assert.ok(formatted.message.includes('status'));
    assert.ok(formatted.message.includes('5s'));
  });

  void it('converts milliseconds to seconds', () => {
    const formatted = formatTimeoutError('peek', 10000);

    assert.ok(formatted.message.includes('10s'));
  });
});

void describe('formatEarlyCloseError', () => {
  void it('includes request name', () => {
    const formatted = formatEarlyCloseError('status');

    assert.ok(formatted.message.includes('status'));
  });

  void it('indicates connection closed before response', () => {
    const formatted = formatEarlyCloseError('peek');

    assert.ok(formatted.message.includes('Connection closed'));
    assert.ok(formatted.message.includes('before'));
    assert.ok(formatted.message.includes('response received'));
  });
});

void describe('all error formatters', () => {
  void it('return Error instances', () => {
    const formatters = [
      () => formatConnectionError('test', '/tmp/sock', new Error('test')),
      () => formatParseError('test', new Error('test')),
      () => formatTimeoutError('test', 5000),
      () => formatEarlyCloseError('test'),
    ];

    formatters.forEach((fn) => {
      assert.ok(fn() instanceof Error);
    });
  });
});
