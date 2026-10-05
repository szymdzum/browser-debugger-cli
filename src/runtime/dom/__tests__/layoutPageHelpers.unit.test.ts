/**
 * Pure page-side helpers of `bdg dom layout`, evaluated outside a browser.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  CLIP_PATH_CUTS_ALL_JS,
  CLIP_RECT_CUTS_ALL_JS,
  SCALES_ONLY_JS,
} from '@/runtime/dom/elementGeometry.js';
import { CLEAR_OF_SCROLLBAR_JS } from '@/runtime/dom/layout.js';

/**
 * Turn page-side function source into a callable function.
 *
 * @param source - Function expression source
 * @returns The function
 */
function pageFunction<Args extends unknown[], Result>(source: string): (...args: Args) => Result {
  return runInNewContext(`(${source})`) as (...args: Args) => Result;
}

const clearOfScrollbar = pageFunction<[number, number, number, boolean], number>(
  CLEAR_OF_SCROLLBAR_JS
);
const clipPathCutsAll = pageFunction<[string], boolean>(CLIP_PATH_CUTS_ALL_JS);
const clipRectCutsAll = pageFunction<[string, string], boolean>(CLIP_RECT_CUTS_ALL_JS);
const scalesOnly = pageFunction<[{ transform: string; rotate?: string }], boolean>(SCALES_ONLY_JS);

void describe('CLEAR_OF_SCROLLBAR_JS', () => {
  void it('ends a span before the overlay scrollbar strip when it also shows outside it', () => {
    assert.equal(clearOfScrollbar(972, 993, 993, true), 977);
  });

  void it('keeps the span without overlay scrollbars, so a cover in the last 16px is found', () => {
    assert.equal(clearOfScrollbar(972, 993, 993, false), 993);
  });

  void it('keeps a span that lies entirely in the strip or ends before it', () => {
    assert.equal(clearOfScrollbar(980, 993, 993, true), 993);
    assert.equal(clearOfScrollbar(100, 900, 993, true), 900);
  });
});

void describe('CLIP_PATH_CUTS_ALL_JS', () => {
  void it('finds inset() percentages that leave no area', () => {
    assert.equal(clipPathCutsAll('inset(100%)'), true);
    assert.equal(clipPathCutsAll('inset(50%)'), true);
    assert.equal(clipPathCutsAll('inset(0% 60% 0% 40%)'), true);
    assert.equal(clipPathCutsAll('inset(50% round 4px)'), true);
  });

  void it('leaves other clip paths alone', () => {
    assert.equal(clipPathCutsAll('none'), false);
    assert.equal(clipPathCutsAll('inset(10%)'), false);
    assert.equal(clipPathCutsAll('inset(10px)'), false);
    assert.equal(clipPathCutsAll('circle(0px)'), false);
  });
});

void describe('CLIP_RECT_CUTS_ALL_JS', () => {
  void it('finds the sr-only clip on positioned elements', () => {
    assert.equal(clipRectCutsAll('absolute', 'rect(0px, 0px, 0px, 0px)'), true);
    assert.equal(clipRectCutsAll('fixed', 'rect(1px, 1px, 1px, 1px)'), true);
  });

  void it('ignores clips with area, unpositioned elements and auto', () => {
    assert.equal(clipRectCutsAll('absolute', 'rect(0px, 100px, 20px, 0px)'), false);
    assert.equal(clipRectCutsAll('static', 'rect(0px, 0px, 0px, 0px)'), false);
    assert.equal(clipRectCutsAll('absolute', 'auto'), false);
  });
});

void describe('SCALES_ONLY_JS', () => {
  void it('accepts no transform, scale and translation', () => {
    assert.equal(scalesOnly({ transform: 'none', rotate: 'none' }), true);
    assert.equal(scalesOnly({ transform: 'matrix(0.5, 0, 0, 0.5, 10, 20)' }), true);
  });

  void it('rejects rotation, skew, 3D transforms and the rotate property', () => {
    assert.equal(scalesOnly({ transform: 'matrix(0.707, 0.707, -0.707, 0.707, 0, 0)' }), false);
    assert.equal(scalesOnly({ transform: 'matrix(1, 0, 0.5, 1, 0, 0)' }), false);
    assert.equal(
      scalesOnly({ transform: 'matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)' }),
      false
    );
    assert.equal(scalesOnly({ transform: 'none', rotate: '45deg' }), false);
  });
});
