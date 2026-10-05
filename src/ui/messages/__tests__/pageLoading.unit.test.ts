/**
 * Messages for pages still loading and for `bdg dom wait`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { pageLoadingWarning, waitMetMessage, waitSnapshotSummary } from '@/ui/messages/commands.js';
import { startNotices } from '@/ui/messages/session.js';

const JQUERY_UI = {
  method: 'GET',
  url: 'https://code.jquery.com/ui/1.13.2/jquery-ui.js',
  resourceType: 'Script',
  pendingMs: 30_000,
};

void describe('pageLoadingWarning', () => {
  void it('names the readyState and the pending requests', () => {
    const warning = pageLoadingWarning({
      readyState: 'loading',
      pending: [JQUERY_UI],
      pendingCount: 1,
    });
    assert.match(
      warning,
      /^The page is still loading \(document\.readyState: loading\); waiting on: GET code\.jquery\.com\/ui\/1\.13\.2\/jquery-ui\.js \(pending 30s\)\./
    );
    assert.match(warning, /bdg dom wait <selector>/);
  });

  void it('counts requests beyond the named ones', () => {
    const warning = pageLoadingWarning({
      readyState: 'interactive',
      pending: [JQUERY_UI, JQUERY_UI, JQUERY_UI],
      pendingCount: 5,
    });
    assert.match(warning, /\(pending 30s\) and 2 more\./);
  });

  void it('leaves out the request list when none is known', () => {
    const warning = pageLoadingWarning({ readyState: 'loading', pending: [], pendingCount: 0 });
    assert.match(warning, /^The page is still loading \(document\.readyState: loading\)\. /);
  });

  void it('is one of the start notices', () => {
    const notices = startNotices({
      url: 'https://a.test/',
      loading: { readyState: 'loading', pending: [JQUERY_UI], pendingCount: 1 },
    });
    assert.equal(notices.length, 1);
    assert.match(notices[0] ?? '', /^⚠ The page is still loading/);
  });
});

void describe('waitMetMessage', () => {
  void it('says what was met and when', () => {
    assert.equal(
      waitMetMessage({ selector: 'div#finish', visible: true }, 5_080),
      '✓ div#finish visible after 5.1s'
    );
    assert.equal(waitMetMessage({ selector: '#x' }, 40), '✓ #x found after 0.0s');
    assert.equal(
      waitMetMessage({ selector: '#spin', gone: true }, 1_500),
      '✓ #spin gone after 1.5s'
    );
    assert.equal(
      waitMetMessage({ selector: '#spin', gone: true, visible: true }, 1_500),
      '✓ #spin hidden after 1.5s'
    );
    assert.equal(
      waitMetMessage({ selector: '#s', text: 'Done', load: true }, 2_000),
      '✓ #s with text "Done" found and page loaded after 2.0s'
    );
    assert.equal(waitMetMessage({ load: true }, 3_210), '✓ Page loaded after 3.2s');
  });
});

void describe('waitSnapshotSummary', () => {
  const complete = { count: 2, textCount: 2, visibleCount: 0, readyState: 'complete' };

  void it('describes matches, text matches and visible ones', () => {
    assert.equal(
      waitSnapshotSummary(complete, { selector: '#a', visible: true }),
      '2 matches, none visible'
    );
    assert.equal(
      waitSnapshotSummary(
        { ...complete, textCount: 0 },
        { selector: '#a', text: 'Hi', visible: true }
      ),
      '2 matches, none with text "Hi"'
    );
    assert.equal(
      waitSnapshotSummary({ ...complete, count: 0, textCount: 0 }, { selector: '#a' }),
      'no matches'
    );
    assert.equal(
      waitSnapshotSummary({ ...complete, count: 1, textCount: 1 }, { selector: '#a' }),
      '1 match'
    );
  });

  void it('adds the readyState for --load and for a page still loading', () => {
    const loading = { count: 0, textCount: 0, visibleCount: 0, readyState: 'loading' };
    assert.equal(waitSnapshotSummary(loading, { load: true }), 'document.readyState: loading');
    assert.equal(
      waitSnapshotSummary(loading, { selector: '#a' }),
      'no matches, document.readyState: loading'
    );
  });
});
