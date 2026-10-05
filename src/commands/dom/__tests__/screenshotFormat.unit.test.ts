/**
 * Screenshot format resolution from `--format` and the file extension, and
 * the element given as an argument (#332).
 */

import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveImageFormat, withPositionalTarget } from '@/commands/dom/screenshot.js';
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

void describe('withPositionalTarget', () => {
  void it('takes a selector or an index from the element argument', () => {
    assert.deepEqual(withPositionalTarget('#sel', {}), { selector: '#sel' });
    assert.deepEqual(withPositionalTarget('2', {}), { index: 2 });
    assert.deepEqual(withPositionalTarget(undefined, { selector: '#a' }), { selector: '#a' });
  });

  void it('accepts the same element twice', () => {
    assert.deepEqual(withPositionalTarget('#a', { selector: '#a' }), { selector: '#a' });
    assert.deepEqual(withPositionalTarget('1', { index: 1 }), { index: 1 });
  });

  void it('refuses different elements with 81', () => {
    for (const [target, options] of [
      ['#b', { selector: '#a' }],
      ['2', { index: 1 }],
    ] as const) {
      assert.throws(
        () => withPositionalTarget(target, options),
        (error: unknown) =>
          error instanceof CommandError &&
          error.exitCode === EXIT_CODES.INVALID_ARGUMENTS &&
          /name different elements/.test(error.message)
      );
    }
  });
});
