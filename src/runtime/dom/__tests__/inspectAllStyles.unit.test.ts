/**
 * `dom inspect --all`: which computed longhands are listed and how they are
 * collapsed into shorthands.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allStyles } from '@/runtime/dom/inspectAllStyles.js';

const BASE = {
  display: 'block',
  color: 'rgb(0, 0, 0)',
  'font-family': 'Arial',
  'font-size': '16px',
  'font-weight': '400',
  'line-height': 'normal',
};

void describe('--all', () => {
  void it('lists a transition as one shorthand, one entry per property, defaults left out', () => {
    const all = allStyles(
      {
        ...BASE,
        'transition-property': 'background-color, box-shadow',
        'transition-duration': '0.25s, 0.25s',
        'transition-timing-function': 'cubic-bezier(0.4, 0, 0.2, 1), ease',
        'transition-delay': '0s, 0s',
        'transition-behavior': 'normal, normal',
      },
      false
    );
    assert.equal(
      all['transition'],
      'background-color 0.25s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.25s'
    );
  });

  void it('leaves out transitions that do not run', () => {
    const all = allStyles(
      { ...BASE, 'transition-property': 'all', 'transition-duration': '0s' },
      false
    );
    assert.equal(all['transition'], undefined);
    assert.equal(all['transition-property'], undefined);
  });

  void it('lists appearance: none on form controls only, and a cleared tap highlight', () => {
    const style = {
      ...BASE,
      appearance: 'none',
      '-webkit-tap-highlight-color': 'rgba(0, 0, 0, 0)',
    };
    assert.equal(allStyles(style, false, true)['appearance'], 'none');
    assert.equal(allStyles(style, false)['appearance'], undefined);
    assert.equal(allStyles(style, false)['-webkit-tap-highlight-color'], 'transparent');
    const untouched = { ...BASE, '-webkit-tap-highlight-color': 'rgba(0, 0, 0, 0.18)' };
    assert.equal(allStyles(untouched, false)['-webkit-tap-highlight-color'], undefined);
  });

  void it('leaves out SVG paint defaults and keeps what is set', () => {
    const all = allStyles(
      {
        ...BASE,
        fill: 'rgb(255, 0, 0)',
        'stop-color': 'rgb(0, 0, 0)',
        'flood-opacity': '1',
        'stroke-width': '1px',
        stroke: 'none',
      },
      true
    );
    assert.equal(all['fill'], '#f00');
    assert.equal(all['stop-color'], undefined);
    assert.equal(all['flood-opacity'], undefined);
    assert.equal(all['stroke-width'], undefined);
    assert.equal(all['stroke'], undefined);
  });
});
