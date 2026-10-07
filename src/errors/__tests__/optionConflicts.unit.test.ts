/**
 * Option combinations bdg refuses say how to fix them in `suggestion`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { conflictingOptionsError, optionRequiresError } from '@/errors/messages.js';

void describe('option conflict errors', () => {
  void it('name both options and suggest dropping one', () => {
    assert.deepEqual(conflictingOptionsError('--double', '--right'), {
      message: '--double cannot be combined with --right',
      suggestion: 'Use one of them: drop --double or --right',
    });
  });

  void it('say which option another one needs', () => {
    assert.deepEqual(optionRequiresError('--all', '--raw'), {
      message: '--all only works with --raw',
      suggestion: 'Add --raw, or drop --all',
    });
  });
});
