/**
 * Screenshot option conflicts carry a suggestion with their error (#883): the
 * corrected command for `--padding` without an element, and the format for
 * `--quality` on a PNG.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handleDomScreenshot } from '@/commands/dom/screenshot.js';
import type { DomScreenshotCommandOptions } from '@/commands/shared/optionTypes.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Capture with invalid options.
 *
 * @param options - The conflicting options
 * @returns The rejection
 */
async function rejection(options: Partial<DomScreenshotCommandOptions>): Promise<CommandError> {
  try {
    await handleDomScreenshot('out.png', undefined, options);
  } catch (error) {
    assert.ok(error instanceof CommandError);
    return error;
  }
  assert.fail('handleDomScreenshot accepted conflicting options');
}

void describe('screenshot option conflicts', () => {
  void it('suggests naming an element for --padding', async () => {
    const error = await rejection({ padding: 16 });
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(String(error.metadata.suggestion), /bdg dom screenshot/);
    assert.match(String(error.metadata.suggestion), /--padding/);
  });

  void it('suggests --format jpeg for --quality on a PNG', async () => {
    const error = await rejection({ quality: 2 });
    assert.equal(error.exitCode, EXIT_CODES.INVALID_ARGUMENTS);
    assert.match(String(error.metadata.suggestion), /--format jpeg/);
  });
});
