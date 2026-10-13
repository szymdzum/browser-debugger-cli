/**
 * The `dom screenshot --follow` stop line pluralises the frame count (#714).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { capturedFramesMessage } from '@/ui/messages/commands.js';

void describe('capturedFramesMessage', () => {
  void it('uses the singular for one frame', () => {
    assert.equal(capturedFramesMessage(1), 'Captured 1 frame');
  });

  void it('uses the plural for zero and several frames', () => {
    assert.equal(capturedFramesMessage(0), 'Captured 0 frames');
    assert.equal(capturedFramesMessage(2), 'Captured 2 frames');
  });
});
