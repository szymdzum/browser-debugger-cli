/**
 * The daemon-side `eval --full` size cap (#693).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EVAL_FULL_MAX_BYTES } from '@/constants.js';
import { CommandError } from '@/errors/index.js';
import { assertWithinFullCap } from '@/runtime/dom/evalHelpers.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * The error a check throws.
 *
 * @param check - The check
 * @returns The CommandError
 */
function refusal(check: () => void): CommandError {
  try {
    check();
  } catch (error) {
    assert.ok(error instanceof CommandError);
    return error;
  }
  return assert.fail('not refused');
}

void describe('assertWithinFullCap', () => {
  void it('refuses a serializer RangeError as over the cap, exit 81', () => {
    const throwing = (): string => {
      throw new RangeError('Invalid string length');
    };
    const error = refusal(() => assertWithinFullCap({ a: 1 }, throwing as typeof JSON.stringify));
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(error.message, /over 512 MiB.*50 MiB limit/);
  });

  void it('passes other serializer errors on', () => {
    const throwing = (): string => {
      throw new TypeError('boom');
    };
    assert.throws(() => assertWithinFullCap({}, throwing as typeof JSON.stringify), TypeError);
  });

  void it('measures bytes, not characters, and names the bytes at the cap', () => {
    const fits = Math.floor(EVAL_FULL_MAX_BYTES / 3);
    const error = refusal(() => assertWithinFullCap('€'.repeat(fits + 1)));
    assert.match(error.message, new RegExp(`${3 * (fits + 1)} bytes, over the 50 MiB`));
    assert.doesNotThrow(() => assertWithinFullCap('€'.repeat(fits)));
  });
});
