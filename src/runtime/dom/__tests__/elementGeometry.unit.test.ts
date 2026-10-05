/**
 * Classifying where an element is relative to the viewport.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyViewportPosition, type ElementGeometry } from '@/runtime/dom/elementGeometry.js';

const VIEWPORT = { width: 1000, height: 800 };

/**
 * Geometry of a rendered element in the main document.
 *
 * @param x - Left edge in viewport coordinates
 * @param y - Top edge in viewport coordinates
 * @param width - Width
 * @param height - Height
 * @param clip - Area its iframes and overflow containers leave visible
 * @returns Geometry
 */
function at(
  x: number,
  y: number,
  width = 100,
  height = 40,
  clip: ElementGeometry['clip'] = null
): ElementGeometry {
  return {
    rect: { x, y, width, height },
    clip,
    clipper: null,
    hidden: null,
    inert: false,
    offset: { x: 0, y: 0 },
  };
}

void describe('classifyViewportPosition', () => {
  void it('reports an element fully inside the viewport as visible', () => {
    assert.deepEqual(classifyViewportPosition(at(10, 10), VIEWPORT), { inViewport: 'visible' });
  });

  void it('reports an element below the fold with the scroll that shows it fully', () => {
    assert.deepEqual(classifyViewportPosition(at(20, 1180), VIEWPORT), {
      inViewport: 'below',
      scrollBy: { x: 0, y: 420 },
    });
  });

  void it('scrolls to the top of an element taller than the viewport', () => {
    assert.deepEqual(classifyViewportPosition(at(0, 900, 100, 2000), VIEWPORT).scrollBy, {
      x: 0,
      y: 900,
    });
  });

  void it('reports elements above, left and right of the viewport', () => {
    assert.deepEqual(classifyViewportPosition(at(10, -300), VIEWPORT), {
      inViewport: 'above',
      scrollBy: { x: 0, y: -300 },
    });
    assert.equal(classifyViewportPosition(at(-200, 10), VIEWPORT).inViewport, 'left');
    assert.equal(classifyViewportPosition(at(1200, 10), VIEWPORT).inViewport, 'right');
  });

  void it('prefers the vertical direction for an element outside on both axes', () => {
    assert.equal(classifyViewportPosition(at(1200, 1200), VIEWPORT).inViewport, 'below');
  });

  void it('reports the visible share of an element crossing the fold', () => {
    assert.deepEqual(classifyViewportPosition(at(0, 790, 100, 40), VIEWPORT), {
      inViewport: 'partly',
      percentVisible: 25,
      scrollBy: { x: 0, y: 30 },
    });
  });

  void it('passes on why an element is hidden, wherever it is', () => {
    const geometry = { ...at(0, 2000), hidden: 'display: none' };
    assert.deepEqual(classifyViewportPosition(geometry, VIEWPORT), {
      inViewport: 'hidden',
      hiddenReason: 'display: none',
    });
  });

  void it('names the container an element is scrolled out of instead of a page scroll', () => {
    const list = { x: 0, y: 0, width: 300, height: 200 };
    const geometry = { ...at(0, 400, 100, 40, list), clipper: 'ul#list' };
    assert.deepEqual(classifyViewportPosition(geometry, VIEWPORT), {
      inViewport: 'below',
      clippedBy: 'ul#list',
    });
  });

  void it('names the clipping container of an element below the fold, without page scroll', () => {
    const list = { x: 0, y: 700, width: 300, height: 1000 };
    const geometry = { ...at(0, 1500, 100, 40, list), clipper: 'div#panel' };
    const placement = classifyViewportPosition(geometry, VIEWPORT);
    assert.equal(placement.inViewport, 'below');
    assert.equal(placement.clippedBy, 'div#panel');
    assert.equal(placement.scrollBy, undefined);
  });

  void it('counts only the part its clip leaves visible', () => {
    const frame = { x: 0, y: 0, width: 50, height: 800 };
    const geometry = { ...at(0, 0, 100, 40, frame), clipper: 'iframe#pay' };
    assert.deepEqual(classifyViewportPosition(geometry, VIEWPORT), {
      inViewport: 'partly',
      percentVisible: 50,
      clippedBy: 'iframe#pay',
    });
  });

  void it('keeps an inert element visible (it is shown, just not interactive)', () => {
    assert.deepEqual(classifyViewportPosition({ ...at(10, 10), inert: true }, VIEWPORT), {
      inViewport: 'visible',
    });
  });
});
