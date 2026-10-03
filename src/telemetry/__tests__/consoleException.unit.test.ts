/**
 * Uncaught exception text formatting.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Protocol } from '@/connection/typed-cdp.js';
import { formatExceptionText } from '@/telemetry/console.js';

/**
 * Build minimal CDP exception details.
 *
 * @param overrides - Fields to set
 * @returns Exception details
 */
function details(
  overrides: Partial<Protocol.Runtime.ExceptionDetails>
): Protocol.Runtime.ExceptionDetails {
  return { exceptionId: 1, text: 'Uncaught', lineNumber: 0, columnNumber: 0, ...overrides };
}

void describe('formatExceptionText', () => {
  void it('includes the error from the description, without the stack', () => {
    const text = formatExceptionText(
      details({
        exception: {
          type: 'object',
          subtype: 'error',
          description: 'TypeError: x is not a function\n    at foo (app.js:1:2)',
        },
      })
    );
    assert.equal(text, 'Uncaught TypeError: x is not a function');
  });

  void it('keeps multi-line messages but drops stack frames', () => {
    const text = formatExceptionText(
      details({
        exception: {
          type: 'object',
          description:
            'Error: first line\nsecond line\n    at foo (app.js:1:2)\n    at bar (app.js:3:4)',
        },
      })
    );
    assert.equal(text, 'Uncaught Error: first line\nsecond line');
  });

  void it('keeps the promise prefix for unhandled rejections', () => {
    const text = formatExceptionText(
      details({
        text: 'Uncaught (in promise)',
        exception: { type: 'object', subtype: 'error', description: 'Error: boom' },
      })
    );
    assert.equal(text, 'Uncaught (in promise) Error: boom');
  });

  void it('uses the value for thrown primitives', () => {
    const text = formatExceptionText(details({ exception: { type: 'string', value: 'boom' } }));
    assert.equal(text, 'Uncaught boom');
  });

  void it('falls back to text when there is no exception object', () => {
    assert.equal(formatExceptionText(details({ text: 'Script error.' })), 'Script error.');
  });

  void it('does not duplicate a prefix the description already has', () => {
    const text = formatExceptionText(
      details({ text: 'Error: boom', exception: { type: 'object', description: 'Error: boom' } })
    );
    assert.equal(text, 'Error: boom');
  });
});
