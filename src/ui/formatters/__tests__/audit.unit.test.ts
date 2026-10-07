/**
 * Human output of `bdg dom audit`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatAudit } from '@/ui/formatters/audit.js';

void describe('formatAudit', () => {
  void it('lists faded text with its opacity, and counts text it cannot measure', () => {
    const output = formatAudit({
      checks: ['contrast'],
      walked: 10,
      contrast: {
        level: 'AA',
        checked: 3,
        failing: 1,
        uncertain: 2,
        items: [
          {
            element: 'p.note',
            text: 'Faded note',
            ratio: 1.87,
            color: '#8a8f98',
            background: '#08090a',
            size: 16,
            weight: 400,
            inView: true,
            opacity: 0.4,
          },
        ],
      },
    });
    assert.match(output, /p\.note "Faded note" 16px \(faded: opacity 0\.4\)$/m);
    assert.match(
      output,
      /\(\+2 more may be below it but cannot be measured: text over images or blended layers; check them with bdg dom inspect <element>\)/
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
