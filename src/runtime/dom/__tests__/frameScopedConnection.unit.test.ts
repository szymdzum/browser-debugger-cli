/**
 * Elements of a cross-origin iframe in the page's process (from a11y queries):
 * page scripts run on the element, and layout places it through its iframe.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ElementGeometry } from '@/runtime/dom/elementGeometry.js';
import { placeInOwnerFrame } from '@/runtime/dom/frameLayout.js';
import { evaluateOnNodeParams } from '@/runtime/dom/frameScopedConnection.js';
import type { RawLayout } from '@/runtime/dom/layout.js';

/**
 * Geometry of a rendered element.
 *
 * @param x - Left edge
 * @param y - Top edge
 * @param overrides - Other fields
 * @returns Geometry
 */
function geometry(x: number, y: number, overrides: Partial<ElementGeometry> = {}): ElementGeometry {
  return {
    rect: { x, y, width: 80, height: 20 },
    clip: null,
    clipOverlay: { right: false, bottom: false },
    clipper: null,
    hidden: null,
    invisible: null,
    inert: false,
    fixed: false,
    pageScroll: { left: 0, up: 0, right: 0, down: 0 },
    offset: { x: 0, y: 0 },
    ...overrides,
  };
}

/**
 * Layout of one element.
 *
 * @param element - Its description
 * @param measured - Its geometry
 * @param viewport - Viewport of the document it was measured in
 * @returns Raw layout
 */
function layoutOf(
  element: string,
  measured: ElementGeometry,
  viewport: { width: number; height: number }
): RawLayout {
  return {
    count: 1,
    page: { viewport, scroll: { x: 0, y: 0 }, document: viewport },
    elements: [
      {
        index: 0,
        tag: element.split(/[#.]/)[0] ?? element,
        element,
        text: '',
        context: '',
        geometry: measured,
        coveredBy: null,
        computed: {
          display: 'block',
          visibility: 'visible',
          position: 'static',
          opacity: '1',
          zIndex: 'auto',
        },
      },
    ],
  };
}

void describe('evaluateOnNodeParams', () => {
  void it('runs the expression on the element with the evaluate options it supports', () => {
    assert.deepEqual(
      evaluateOnNodeParams(
        { expression: 'document.title', returnByValue: true, userGesture: true, contextId: 3 },
        'obj-1'
      ),
      {
        returnByValue: true,
        userGesture: true,
        objectId: 'obj-1',
        functionDeclaration: 'function () { return (\ndocument.title\n); }',
      }
    );
  });
});

void describe('placeInOwnerFrame', () => {
  void it('moves the element by the frame offset and takes the top page and the iframe scroll state', () => {
    const inner = layoutOf('button#accept', geometry(90, 50), { width: 400, height: 200 });
    const owner = layoutOf(
      'iframe#consent',
      geometry(150, 80, { fixed: true, pageScroll: { left: 0, up: 0, right: 0, down: 500 } }),
      { width: 1200, height: 800 }
    );
    const placed = placeInOwnerFrame(inner, owner, { x: 154, y: 84 });
    const [element] = placed.elements;
    assert.deepEqual(placed.page, owner.page);
    assert.deepEqual(element?.geometry.rect, { x: 244, y: 134, width: 80, height: 20 });
    assert.deepEqual(element?.geometry.clip, { x: 154, y: 84, width: 400, height: 200 });
    assert.equal(element?.geometry.fixed, true);
    assert.equal(element?.geometry.pageScroll.down, 500);
    assert.equal(element?.geometry.clipper, null);
    assert.equal(element?.context, 'iframe#consent');
  });

  void it('names the iframe as what clips an element outside the frame viewport', () => {
    const inner = layoutOf('a#more', geometry(90, 190), { width: 400, height: 200 });
    const owner = layoutOf('iframe#consent', geometry(150, 80), { width: 1200, height: 800 });
    const [element] = placeInOwnerFrame(inner, owner, { x: 154, y: 84 }).elements;
    assert.equal(element?.geometry.clipper, 'iframe#consent');
  });
});
