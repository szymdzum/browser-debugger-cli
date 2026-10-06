/**
 * Building the `bdg dom layout` report from page-side measurements.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PageLayout } from '@/ipc/protocol/domTypes.js';
import { buildLayoutResult, type RawElementLayout } from '@/runtime/dom/layout.js';

const PAGE: PageLayout = {
  viewport: { width: 1000, height: 800 },
  scroll: { x: 0, y: 300.4 },
  document: { width: 1000, height: 3000 },
};

const COMPUTED = {
  display: 'block',
  visibility: 'visible',
  position: 'static',
  opacity: '1',
  zIndex: 'auto',
};

/**
 * Measurements of one element.
 *
 * @param index - Match index
 * @param y - Top edge in viewport coordinates
 * @param coveredBy - Element at its center, if another one
 * @returns Raw element layout
 */
function element(index: number, y: number, coveredBy: string | null = null): RawElementLayout {
  return {
    index,
    tag: 'button',
    element: 'button#save',
    text: '  Save\n changes ',
    context: '',
    geometry: {
      rect: { x: 10.6, y, width: 120.2, height: 40 },
      clip: null,
      clipOverlay: { right: false, bottom: false },
      clipper: null,
      hidden: null,
      invisible: null,
      inert: false,
      fixed: false,
      pageScroll: { left: 0, up: 300, right: 0, down: 2200 },
      offset: { x: 0, y: 0 },
    },
    cover: coveredBy ? { element: coveredBy, transparent: false } : null,
    computed: COMPUTED,
  };
}

void describe('buildLayoutResult', () => {
  void it('reports page and viewport coordinates in whole pixels', () => {
    const result = buildLayoutResult(
      { count: 1, page: PAGE, elements: [element(0, 100)] },
      { selector: '#save' }
    );
    const [save] = result.elements;
    assert.deepEqual(save?.bounds, { x: 11, y: 400, width: 120, height: 40 });
    assert.deepEqual(save?.viewport, { x: 11, y: 100 });
    assert.equal(save?.text, 'Save changes');
    assert.equal(save?.inViewport, 'visible');
    assert.deepEqual(result.page.scroll, { x: 0, y: 300 });
  });

  void it('reports what covers an element only while it is in view', () => {
    const result = buildLayoutResult(
      {
        count: 2,
        page: PAGE,
        elements: [element(0, 100, 'div#overlay'), element(1, 2000, 'div#footer')],
      },
      { selector: 'button' }
    );
    assert.equal(result.elements[0]?.coveredBy, 'div#overlay');
    assert.equal(result.elements[1]?.coveredBy, undefined);
    assert.equal(result.elements[1]?.inViewport, 'below');
  });

  void it('counts matches beyond the limit as omitted, but not those --index skipped', () => {
    const raw = { count: 150, page: PAGE, elements: [element(0, 100)] };
    assert.equal(buildLayoutResult(raw, { selector: 'li' }).omitted, 149);
    assert.equal(buildLayoutResult(raw, { selector: 'li', index: 0 }).omitted, undefined);
  });

  void it('flags inert elements without calling them hidden', () => {
    const inert = element(0, 100);
    inert.geometry.inert = true;
    const [result] = buildLayoutResult(
      { count: 1, page: PAGE, elements: [inert] },
      { selector: '#save' }
    ).elements;
    assert.equal(result?.inViewport, 'visible');
    assert.equal(result?.inert, true);
    assert.equal(
      buildLayoutResult(
        { count: 1, page: PAGE, elements: [element(0, 100)] },
        { selector: '#save' }
      ).elements[0]?.inert,
      undefined
    );
  });
});
