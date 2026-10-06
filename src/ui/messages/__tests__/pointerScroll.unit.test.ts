/**
 * Messages for how far a pointer action scrolled, and for masked elements.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { inspectVisibilityBadges, pointerScrollText } from '@/ui/messages/commands.js';

void describe('pointerScrollText', () => {
  void it('names the direction and distance the page moved', () => {
    assert.equal(pointerScrollText({ x: 0, y: 1240 }), 'page down 1240px to reach it');
    assert.equal(pointerScrollText({ x: 300, y: -80 }), 'page up 80px, right 300px to reach it');
  });
});

void describe('inspectVisibilityBadges', () => {
  void it('badges a mask over the element', () => {
    assert.deepEqual(inspectVisibilityBadges({ masked: 'mask-image on div.hero' }), [
      '[masked by mask-image on div.hero]',
    ]);
  });
});
