/**
 * Human output of `bdg dom audit`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatAudit } from '@/ui/formatters/audit.js';
import { AUDIT_OUT_OF_VIEW_RISK } from '@/ui/messages/commands.js';

void describe('formatAudit', () => {
  void it('marks out-of-view text whose ancestors paint nothing as approximate', () => {
    const output = formatAudit({
      checks: ['contrast'],
      walked: 10,
      contrast: {
        level: 'AA',
        checked: 1,
        failing: 1,
        items: [
          {
            element: 'p#low',
            text: 'White on an image',
            ratio: 1,
            color: '#fff',
            background: '#fff',
            size: 16,
            weight: 400,
            inView: false,
            approximate: [AUDIT_OUT_OF_VIEW_RISK],
          },
        ],
      },
    });
    assert.match(
      output,
      /p#low "White on an image" 16px \(out of view\) \(approximate: only its ancestors were checked\)$/
    );
  });

  void it('says canvas animations are not listed, with or without other animations', () => {
    const none = formatAudit({ checks: ['animations'], walked: 10, animations: [], canvases: 1 });
    assert.equal(
      none,
      'Animations: none running\n  (+ 1 canvas element: animations drawn by scripts on it are not listed)'
    );
    const some = formatAudit({
      checks: ['animations'],
      walked: 10,
      animations: [
        {
          element: 'div.spin',
          name: 'spin',
          type: 'CSSAnimation',
          duration: 1000,
          iterations: 'infinite',
        },
      ],
      canvases: 3,
    });
    assert.match(
      some,
      /\n {2}\(\+ 3 canvas elements: animations drawn by scripts on them are not listed\)$/
    );
    assert.doesNotMatch(
      formatAudit({ checks: ['animations'], walked: 10, animations: [] }),
      /canvas/
    );
  });
});
