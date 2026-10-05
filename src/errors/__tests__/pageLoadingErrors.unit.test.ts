/**
 * "Not found" hints for pages still loading, and `bdg dom wait` timeouts.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  noNodesFoundError,
  pageStillLoadingHint,
  waitTimeoutError,
  withLoadingHint,
} from '@/errors/messages.js';

void describe('loading hints', () => {
  void it('suggests dom wait for the selector, quoted for the shell', () => {
    assert.equal(
      pageStillLoadingHint('loading', "a[title='x']"),
      `The page is still loading (document.readyState: loading); wait for the element with: bdg dom wait 'a[title='\\''x'\\'']'`
    );
    assert.match(pageStillLoadingHint('interactive'), /wait for it with: bdg dom wait --load$/);
  });

  void it('is added before the suggestion only while the page loads', () => {
    assert.equal(withLoadingHint('Check it', 'complete', '#a'), 'Check it');
    assert.equal(withLoadingHint('Check it', undefined, '#a'), 'Check it');
    assert.equal(
      withLoadingHint('Check it', 'loading', '#a'),
      "The page is still loading (document.readyState: loading); wait for the element with: bdg dom wait '#a'\nCheck it"
    );
    assert.equal(withLoadingHint('', 'loading'), pageStillLoadingHint('loading'));
  });

  void it('is part of the no-nodes error', () => {
    assert.match(
      noNodesFoundError('#late', { readyState: 'loading' }).suggestion,
      /^The page is still loading/
    );
    assert.doesNotMatch(
      noNodesFoundError('#late', { readyState: 'complete' }).suggestion,
      /still loading/
    );
  });
});

void describe('waitTimeoutError', () => {
  void it('says what was waited for and what was seen last', () => {
    const err = waitTimeoutError(
      { selector: 'div#finish', visible: true },
      { count: 2, textCount: 2, visibleCount: 0, readyState: 'complete', documentId: 1 },
      10_000
    );
    assert.equal(
      err.message,
      'Timed out after 10s waiting for div#finish to be visible (last seen: 2 matches, none visible)'
    );
    assert.match(err.suggestion, /hidden; see why with bdg dom layout 'div#finish'/);
  });

  void it('points to the selector when nothing matched', () => {
    const err = waitTimeoutError(
      { selector: '#nope' },
      { count: 0, textCount: 0, visibleCount: 0, readyState: 'complete', documentId: 1 },
      1_500
    );
    assert.equal(
      err.message,
      'Timed out after 1.5s waiting for #nope to appear (last seen: no matches)'
    );
    assert.match(err.suggestion, /bdg dom query '#nope'/);
  });

  void it('points to the text when the matches lack it', () => {
    const err = waitTimeoutError(
      { selector: '#s', text: 'Done' },
      { count: 1, textCount: 0, visibleCount: 0, readyState: 'complete', documentId: 1 },
      500
    );
    assert.match(
      err.message,
      /waiting for #s with text "Done" to appear \(last seen: 1 match, none with text "Done"\)/
    );
    assert.match(err.suggestion, /do not contain the text/);
  });

  void it('names a page still loading and a page that never answered', () => {
    const loading = waitTimeoutError(
      { load: true },
      { count: 0, textCount: 0, visibleCount: 0, readyState: 'loading', documentId: 1 },
      1_000
    );
    assert.equal(
      loading.message,
      'Timed out after 1s waiting for the page to load (last seen: document.readyState: loading)'
    );
    assert.match(loading.suggestion, /still loading; see the requests it waits on with bdg peek/);
    const silent = waitTimeoutError({ selector: '#a', gone: true }, undefined, 1_000);
    assert.equal(
      silent.message,
      'Timed out after 1s waiting for #a to be gone (the page did not answer)'
    );
  });
});
