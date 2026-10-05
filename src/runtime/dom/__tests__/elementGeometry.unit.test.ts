/**
 * Classifying where an element is relative to the viewport.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OFF_SCREEN_REASONS,
  classifyViewportPosition,
  type ElementGeometry,
  type ScrollRange,
} from '@/runtime/dom/elementGeometry.js';

const VIEWPORT = { width: 1000, height: 800 };

/** A page that can scroll far in every direction */
const FREE_SCROLL: ScrollRange = { left: 10000, up: 10000, right: 10000, down: 10000 };

/**
 * Geometry of a rendered element in the main document.
 *
 * @param x - Left edge in viewport coordinates
 * @param y - Top edge in viewport coordinates
 * @param width - Width
 * @param height - Height
 * @param clip - Area its iframes and overflow containers leave visible
 * @param pageScroll - How far the page can scroll
 * @returns Geometry
 */
function at(
  x: number,
  y: number,
  width = 100,
  height = 40,
  clip: ElementGeometry['clip'] = null,
  pageScroll: ScrollRange = FREE_SCROLL
): ElementGeometry {
  return {
    rect: { x, y, width, height },
    clip,
    clipOverlay: { right: false, bottom: false },
    clipper: null,
    hidden: null,
    invisible: null,
    inert: false,
    fixed: false,
    pageScroll,
    offset: { x: 0, y: 0 },
  };
}

void describe('classifyViewportPosition', () => {
  void it('reports an element fully inside the viewport as visible', () => {
    assert.deepEqual(classifyViewportPosition(at(10, 10), VIEWPORT), { inViewport: 'visible' });
  });

  void it('reports an element below the fold with the scroll that centres it', () => {
    assert.deepEqual(classifyViewportPosition(at(20, 1180), VIEWPORT), {
      inViewport: 'below',
      scrollBy: { x: 0, y: 800 },
    });
  });

  void it('centres the element away from sticky headers and fixed footers at the edges', () => {
    const { scrollBy } = classifyViewportPosition(at(0, 1263, 32, 21), {
      width: 1920,
      height: 993,
    });
    assert.deepEqual(scrollBy, { x: 0, y: 777 });
    assert.equal(1263 - 777 + 21 / 2, 993 / 2);
  });

  void it('limits the scroll to how far the page can scroll', () => {
    const range = { left: 0, up: 0, right: 0, down: 500 };
    assert.deepEqual(classifyViewportPosition(at(20, 1180, 100, 40, null, range), VIEWPORT), {
      inViewport: 'below',
      scrollBy: { x: 0, y: 500 },
    });
  });

  void it('gives no scroll when the page cannot scroll far enough to show the element', () => {
    const range = { left: 0, up: 0, right: 0, down: 300 };
    assert.deepEqual(classifyViewportPosition(at(20, 1180, 100, 40, null, range), VIEWPORT), {
      inViewport: 'below',
      offScreenReason: OFF_SCREEN_REASONS.outOfRange,
    });
  });

  void it('gives no scroll for an element beyond the start of the page (skip link at -9999px)', () => {
    const range = { left: 0, up: 0, right: 0, down: 4000 };
    assert.deepEqual(classifyViewportPosition(at(-9999, 0, 106, 18, null, range), VIEWPORT), {
      inViewport: 'left',
      offScreenReason: OFF_SCREEN_REASONS.outOfRange,
    });
    assert.deepEqual(classifyViewportPosition(at(0, -500, 106, 18, null, range), VIEWPORT), {
      inViewport: 'above',
      offScreenReason: OFF_SCREEN_REASONS.outOfRange,
    });
  });

  void it('gives no scroll for a fixed element off-screen or partly off-screen', () => {
    const offCanvas = { ...at(-250, 0, 250, 800), fixed: true };
    assert.deepEqual(classifyViewportPosition(offCanvas, VIEWPORT), {
      inViewport: 'left',
      offScreenReason: OFF_SCREEN_REASONS.fixed,
    });
    const peeking = { ...at(900, 0, 200, 40), fixed: true };
    assert.deepEqual(classifyViewportPosition(peeking, VIEWPORT), {
      inViewport: 'partly',
      percentVisible: 50,
      offScreenReason: OFF_SCREEN_REASONS.fixed,
    });
  });

  void it('does not suggest centring a sticky element, which page scroll moves only partly', () => {
    const menu = { ...at(20, -300, 200, 400), sticky: true };
    assert.deepEqual(classifyViewportPosition(menu, VIEWPORT), {
      inViewport: 'partly',
      percentVisible: 25,
      offScreenReason: OFF_SCREEN_REASONS.sticky,
    });
  });

  void it('says that page scrolling is locked for content below the fold of a locked page', () => {
    const locked = {
      ...at(20, 3400, 100, 40, null, { left: 0, up: 0, right: 0, down: 0 }),
      scrollLock: { by: 'position: fixed, overflow: hidden on body', dialog: null },
    };
    assert.deepEqual(classifyViewportPosition(locked, VIEWPORT), {
      inViewport: 'below',
      offScreenReason: 'page scrolling is locked (position: fixed, overflow: hidden on body)',
    });
    const byDialog = {
      ...locked,
      scrollLock: { by: 'overflow: hidden on html', dialog: 'div#consent' },
    };
    assert.deepEqual(classifyViewportPosition(byDialog, VIEWPORT), {
      inViewport: 'below',
      offScreenReason:
        'page scrolling is locked (overflow: hidden on html), likely by dialog div#consent',
    });
    assert.deepEqual(classifyViewportPosition({ ...locked, rect: at(10, 10).rect }, VIEWPORT), {
      inViewport: 'visible',
    });
  });

  void it('reports a fixed element in view as visible', () => {
    assert.deepEqual(classifyViewportPosition({ ...at(0, 760), fixed: true }, VIEWPORT), {
      inViewport: 'visible',
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
      scrollBy: { x: 0, y: -680 },
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
      scrollBy: { x: 0, y: 410 },
    });
  });

  void it('passes on why an element is hidden, wherever it is', () => {
    const geometry = { ...at(0, 2000), hidden: 'display: none' };
    assert.deepEqual(classifyViewportPosition(geometry, VIEWPORT), {
      inViewport: 'hidden',
      hiddenReason: 'display: none',
    });
  });

  void it('reports content that is not rendered as hidden although it has a box', () => {
    for (const reason of ['inside a closed <details>', 'content-visibility: hidden on div#cv']) {
      assert.deepEqual(classifyViewportPosition({ ...at(0, 60), hidden: reason }, VIEWPORT), {
        inViewport: 'hidden',
        hiddenReason: reason,
      });
    }
  });

  void it('names a scrolling body as the clipper instead of advising a page scroll', () => {
    const body = { x: 0, y: 0, width: 1000, height: 800 };
    const range = { left: 0, up: 0, right: 0, down: 0 };
    const geometry = { ...at(0, 3000, 48, 21, body, range), clipper: 'body' };
    assert.deepEqual(classifyViewportPosition(geometry, VIEWPORT), {
      inViewport: 'below',
      clippedBy: 'body',
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
