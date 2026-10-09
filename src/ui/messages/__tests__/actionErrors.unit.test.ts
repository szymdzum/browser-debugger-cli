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

  void it('names the host for a page URL ending in a slash', () => {
    assert.equal(
      actionErrorText({ text: 'boom', source: 'https://app.test/:3:142', count: 1 }),
      'boom (app.test:3:142)'
    );
  });

  void it('leaves out a query that contains slashes', () => {
    assert.equal(
      actionErrorText({ text: 'boom', source: 'https://app.test/a?next=/x/y:3:1', count: 1 }),
      'boom (a:3:1)'
    );
  });

  void it('names the file of a failed load without a position', () => {
    assert.equal(
      actionErrorText({
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
