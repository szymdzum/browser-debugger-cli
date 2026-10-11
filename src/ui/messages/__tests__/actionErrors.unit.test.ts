/**
 * The `Errors:` rows of an action's output.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { actionErrorRows, moreErrorsText } from '@/ui/messages/commands.js';

/**
 * The row of one error.
 *
 * @param error - Reported error
 * @returns Its row
 */
function actionErrorRow(error: Parameters<typeof actionErrorRows>[0][number]): string | undefined {
  return actionErrorRows([error])[0];
}

void describe('actionErrorRows', () => {
  void it('merges errors whose text and short source are the same, counting the sources', () => {
    assert.deepEqual(
      actionErrorRows([
        { text: 'beacon failed', source: 'https://a.test/one/event?a=1:1:9', count: 1 },
        { text: 'beacon failed', source: 'https://a.test/two/event?b=2:1:9', count: 1 },
        { text: 'other', count: 1 },
      ]),
      ['[2x] beacon failed (event:1:9, 2 sources)', 'other']
    );
  });

  void it('names the file, line and column of the source', () => {
    assert.equal(
      actionErrorRow({
        text: 'Uncaught Error: handler exploded',
        source: 'http://app.test/js/app.js:3:142',
        count: 1,
      }),
      'Uncaught Error: handler exploded (app.js:3:142)'
    );
  });

  void it('counts repeats like bdg console', () => {
    assert.equal(actionErrorRow({ text: 'boom', count: 2 }), '[2x] boom');
  });

  void it('names the host for a page URL ending in a slash', () => {
    assert.equal(
      actionErrorRow({ text: 'boom', source: 'https://app.test/:3:142', count: 1 }),
      'boom (app.test:3:142)'
    );
  });

  void it('leaves out a query that contains slashes', () => {
    assert.equal(
      actionErrorRow({ text: 'boom', source: 'https://app.test/a?next=/x/y:3:1', count: 1 }),
      'boom (a:3:1)'
    );
  });

  void it('names the file of a failed load without a position', () => {
    assert.equal(
      actionErrorRow({
        text: 'Failed to load resource',
        source: 'https://app.test/api/items',
        count: 1,
      }),
      'Failed to load resource (items)'
    );
  });
});

void describe('moreErrorsText', () => {
  void it('points at bdg console for the rest', () => {
    assert.equal(moreErrorsText(2), '+2 more (bdg console --level error)');
  });
});
