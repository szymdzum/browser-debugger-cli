/**
 * Actions on a selector matching several elements say which one was used.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { withMultipleMatchesWarning } from '@/runtime/dom/formFillHelpers/shared.js';

type Matched = { matchCount: number; warning?: string };

/**
 * Apply the warning to a result with `matchCount` matches.
 *
 * @param result - Result
 * @param index - The --index given, if any
 * @returns The result with its warning, if any
 */
function warned(result: Matched, index?: number): string | undefined {
  return withMultipleMatchesWarning(result, index, 'clicked the first').warning;
}

void describe('withMultipleMatchesWarning', () => {
  void it('warns when several elements match and no index was given', () => {
    assert.match(
      warned({ matchCount: 3 }) ?? '',
      /^3 elements match; clicked the first \(use --index/
    );
  });

  void it('stays quiet for a single match or an explicit index', () => {
    assert.equal(warned({ matchCount: 1 }), undefined);
    assert.equal(warned({ matchCount: 3 }, 0), undefined);
  });

  void it('keeps an existing warning', () => {
    assert.match(warned({ matchCount: 2, warning: 'Covered' }) ?? '', /^Covered; 2 elements match/);
  });
});
