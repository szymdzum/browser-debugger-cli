/**
 * `bdg dom scroll` that moved nothing: why, and the still-loading hint.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { scrollNoEffectWarning } from '@/errors/messages.js';

void describe('scrollNoEffectWarning', () => {
  void it('says a document no taller than the viewport has nothing to scroll', () => {
    assert.equal(
      scrollNoEffectWarning({
        direction: 'down',
        reason: 'too-small',
        viewport: 993,
        readyState: 'complete',
      }),
      'Nothing to scroll: the document is no taller than the viewport (993px)'
    );
  });

  void it('adds the still-loading hint while the document loads', () => {
    assert.match(
      scrollNoEffectWarning({
        direction: 'down',
        reason: 'too-small',
        viewport: 993,
        readyState: 'loading',
      }),
      /\(993px\)\. The page is still loading \(document\.readyState: loading\); wait for it with: bdg dom wait --load$/
    );
  });

  void it('says when the page is already at the edge, or did not move although it could', () => {
    assert.equal(
      scrollNoEffectWarning({
        direction: 'up',
        reason: 'at-edge',
        viewport: 800,
        readyState: 'complete',
      }),
      'Nothing scrolled: the page is already at the top'
    );
    assert.match(
      scrollNoEffectWarning({
        direction: 'right',
        reason: 'locked',
        viewport: 800,
        readyState: 'complete',
      }),
      /scrolling may be locked/
    );
  });
});
