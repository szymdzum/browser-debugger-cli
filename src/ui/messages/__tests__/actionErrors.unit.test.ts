/**
 * The `Errors:` rows of an action's output.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { actionErrorText, moreErrorsText } from '@/ui/messages/commands.js';

void describe('actionErrorText', () => {
  void it('names the file, line and column of the source', () => {
    assert.equal(
      actionErrorText({
        text: 'Uncaught Error: handler exploded',
        source: 'http://app.test/js/app.js:3:142',
        count: 1,
      }),
      'Uncaught Error: handler exploded (app.js:3:142)'
    );
  });

  void it('counts repeats like bdg console', () => {
    assert.equal(actionErrorText({ text: 'boom', count: 2 }), '[2x] boom');
  });

  void it('keeps a URL ending in a slash whole', () => {
    assert.equal(
      actionErrorText({ text: 'boom', source: 'http://app.test/', count: 1 }),
      'boom (http://app.test/)'
    );
  });
});

void describe('moreErrorsText', () => {
  void it('points at bdg console for the rest', () => {
    assert.equal(moreErrorsText(2), '+2 more (bdg console --level error)');
  });
});
