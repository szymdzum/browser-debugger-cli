/**
 * Mouse event sequences of click, double click, right click and hover.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { mouseEvents } from '@/runtime/dom/formFillHelpers/fill.js';

/**
 * Event types with their button and click count.
 *
 * @param events - Dispatched events
 * @returns Readable summary
 */
function summary(events: Array<Record<string, unknown>>): string[] {
  return events.map((event) =>
    [event['type'], event['button'], event['clickCount']].filter(Boolean).join(':')
  );
}

void describe('mouseEvents', () => {
  void it('presses twice for a double click, with click counts 1 and 2', () => {
    assert.deepEqual(summary(mouseEvents('double', 5, 5)), [
      'mouseMoved',
      'mousePressed:left:1',
      'mouseReleased:left:1',
      'mousePressed:left:2',
      'mouseReleased:left:2',
    ]);
  });

  void it('uses the right button for a right click and only moves for hover', () => {
    assert.deepEqual(summary(mouseEvents('right', 5, 5)), [
      'mouseMoved',
      'mousePressed:right:1',
      'mouseReleased:right:1',
    ]);
    assert.deepEqual(summary(mouseEvents('hover', 5, 5)), ['mouseMoved']);
  });
});
