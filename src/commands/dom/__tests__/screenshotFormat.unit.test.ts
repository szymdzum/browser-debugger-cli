/**
 * Screenshot format resolution from `--format` and the file extension.
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveImageFormat } from '@/commands/dom/screenshot.js';
import { CommandError } from '@/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

void describe('resolveImageFormat', () => {
  void it('takes the format from the extension, in any case', () => {
    assert.equal(resolveImageFormat('shot.jpg'), 'jpeg');
    assert.equal(resolveImageFormat('SHOT.JPEG'), 'jpeg');
    assert.equal(resolveImageFormat('shot.png'), 'png');
  });

  void it('falls back to PNG without a known image extension', () => {
    assert.equal(resolveImageFormat('shot'), 'png');
    assert.equal(resolveImageFormat('shot.v2'), 'png');
    assert.equal(resolveImageFormat('.png'), 'png');
  });

  void it('uses --format when the extension agrees or says nothing', () => {
    assert.equal(resolveImageFormat('shot.jpg', 'jpeg'), 'jpeg');
    assert.equal(resolveImageFormat('shot', 'jpeg'), 'jpeg');
  });

  void it('refuses contradictions and formats Chrome cannot write', () => {
    for (const [path, format] of [
      ['shot.png', 'jpeg'],
      ['shot.jpg', 'png'],
      ['shot.gif', undefined],
      ['shot.webp', 'png'],
    ] as const) {
      assert.throws(
        () => resolveImageFormat(path, format),
        (error: unknown) =>
          error instanceof CommandError && error.exitCode === EXIT_CODES.INVALID_ARGUMENTS,
        `${path} --format ${format}`
      );
    }
  });
});
