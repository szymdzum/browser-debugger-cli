/**
 * Elements of a cross-origin iframe in the page's process (from a11y queries):
 * page scripts run on the element, mouse events and layout are mapped through
 * the iframe's position and scale, and a frame that cannot be measured fails
 * instead of clicking somewhere else.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as vm from 'node:vm';

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import type { ElementGeometry } from '@/runtime/dom/elementGeometry.js';
import { clickElement, fillElement } from '@/runtime/dom/formFillHelpers/fill.js';
import { pressKeyElement } from '@/runtime/dom/formFillHelpers/pressKey.js';
import { scrollPage } from '@/runtime/dom/formFillHelpers/scroll.js';
import { submitForm } from '@/runtime/dom/formSubmitHelpers.js';
import { inside, intersection, placeInOwnerFrame } from '@/runtime/dom/frameLayout.js';
import {
  evaluateOnNodeParams,
  frameMappingFrom,
  frameScopedConnection,
  mapPoint,
} from '@/runtime/dom/frameScopedConnection.js';
import type { RawLayout } from '@/runtime/dom/layout.js';
import { CLICK_ELEMENT_SCRIPT, REACT_FILL_SCRIPT } from '@/runtime/dom/reactEventHelpers.js';
import { BOUND_TARGET_SELECTOR } from '@/runtime/dom/targetNode.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

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

/** A frame at (154, 84) in the top-level viewport, not scaled */
const PLAIN = { origin: { x: 154, y: 84 }, scaleX: 1, scaleY: 1 };

/**
 * A quad of an axis-aligned box.
 *
 * @param x - Left
 * @param y - Top
 * @param width - Width
 * @param height - Height
 * @returns x1,y1,…,x4,y4 clockwise from the top left
 */
function quad(x: number, y: number, width: number, height: number): number[] {
  return [x, y, x + width, y, x + width, y + height, x, y + height];
}

/**
 * Assert that a call fails with the frame mapping error (83).
 *
 * @param run - The call
 * @param message - Expected message part
 */
function assertMappingError(run: () => unknown, message: RegExp): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof CommandError);
    assert.equal(error.exitCode, EXIT_CODES.RESOURCE_NOT_FOUND);
    assert.match(error.message, message);
    return true;
  });
}

void describe('evaluateOnNodeParams', () => {
  void it('runs the expression on the element with the evaluate options it supports', () => {
    assert.deepEqual(
      evaluateOnNodeParams(
        { expression: 'document.title', returnByValue: true, userGesture: true },
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

  void it('refuses evaluate options it cannot pass on instead of dropping them', () => {
    assert.throws(
      () => evaluateOnNodeParams({ expression: '1', timeout: 500 }, 'obj-1'),
      /cannot take timeout/
    );
  });
});

void describe('frameMappingFrom', () => {
  void it('places a frame with border and padding by where CDP sees the element', () => {
    const mapping = frameMappingFrom({
      rect: { x: 90, y: 50, width: 80, height: 20 },
      quads: [quad(262, 148, 80, 20)],
    });
    assert.deepEqual(mapping, { origin: { x: 172, y: 98 }, scaleX: 1, scaleY: 1 });
  });

  void it('scales points of a frame scaled to half its size', () => {
    const mapping = frameMappingFrom({
      rect: { x: 90, y: 50, width: 80, height: 20 },
      quads: [quad(210, 140, 40, 10)],
    });
    assert.equal(mapping.scaleX, 0.5);
    assert.equal(mapping.scaleY, 0.5);
    assert.deepEqual(mapPoint(mapping, { x: 130, y: 60 }), { x: 230, y: 145 });
  });

  void it('treats a difference within rounding as no scale', () => {
    const mapping = frameMappingFrom({
      rect: { x: 0, y: 0, width: 80, height: 20 },
      quads: [quad(10, 10, 80.4, 20.3)],
    });
    assert.equal(mapping.scaleX, 1);
    assert.equal(mapping.scaleY, 1);
  });

  void it('refuses a box without quads or size, and a rotated frame', () => {
    assertMappingError(
      () => frameMappingFrom({ rect: { x: 0, y: 0, width: 80, height: 20 }, quads: [] }),
      /has a box/
    );
    assertMappingError(
      () =>
        frameMappingFrom({ rect: { x: 0, y: 0, width: 0, height: 0 }, quads: [quad(0, 0, 0, 0)] }),
      /has a box/
    );
    assertMappingError(
      () =>
        frameMappingFrom({
          rect: { x: 0, y: 0, width: 80, height: 20 },
          quads: [[10, 0, 90, 10, 80, 30, 0, 20]],
        }),
      /rotated or skewed/
    );
  });
});

/**
 * Fake session connection for the scoped connection: records what reaches
 * Chrome and answers page scripts with a result the interactions accept.
 *
 * @param quads - Content quads CDP reports (none: the measurement fails)
 * @returns The connection and what it was sent
 */
function fakeConnection(quads: () => number[][]): {
  cdp: CDPConnection;
  sent: Array<{ method: string; params: Record<string, unknown> }>;
} {
  const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
  const answer = (method: string, params: Record<string, unknown>): unknown => {
    const declaration =
      typeof params['functionDeclaration'] === 'string' ? params['functionDeclaration'] : '';
    if (method === 'DOM.getContentQuads') return { quads: quads() };
    if (method !== 'Runtime.callFunctionOn') return {};
    if (declaration.includes('ownerDocument.documentElement')) {
      return { result: { objectId: 'reference' } };
    }
    if (declaration.includes('return { x: r.left, y: r.top, width')) {
      return { result: { value: { x: 0, y: 0, width: 10, height: 10 } } };
    }
    return {
      result: {
        value: {
          success: true,
          x: 5,
          y: 5,
          hittable: true,
          scrollType: 'element',
          action: 'click',
        },
      },
    };
  };
  const cdp = {
    send: (method: string, params: Record<string, unknown> = {}) => {
      sent.push({ method, params });
      return Promise.resolve(answer(method, params));
    },
    on: () => () => undefined,
    off: () => undefined,
  } as unknown as CDPConnection;
  return { cdp, sent };
}

void describe('frameScopedConnection', () => {
  void it('passes every interaction script through a wrapper that parses as one expression', async () => {
    const { cdp, sent } = fakeConnection(() => [quad(100, 100, 10, 10)]);
    const scoped = frameScopedConnection(cdp, 'element');
    const runs = [
      () => clickElement(scoped, BOUND_TARGET_SELECTOR, {}),
      () => clickElement(scoped, BOUND_TARGET_SELECTOR, { action: 'hover' }),
      () => fillElement(scoped, BOUND_TARGET_SELECTOR, 'value'),
      () => pressKeyElement(scoped, BOUND_TARGET_SELECTOR, 'Enter'),
      () => scrollPage(scoped, BOUND_TARGET_SELECTOR),
      () => scrollPage(scoped, undefined, { bottom: true }),
      () => submitForm(scoped, BOUND_TARGET_SELECTOR, { waitNetwork: 0 }),
    ];
    for (const run of runs) await run().catch(() => undefined);

    const wrapped = sent
      .filter(({ params }) => params['objectId'] === 'element')
      .map(({ params }) => String(params['functionDeclaration']));
    assert.ok(wrapped.some((source) => source.includes(CLICK_ELEMENT_SCRIPT)));
    assert.ok(wrapped.some((source) => source.includes(REACT_FILL_SCRIPT)));
    assert.ok(wrapped.length >= 10, `${wrapped.length} scripts`);
    for (const source of wrapped) {
      assert.doesNotThrow(() => new vm.Script(`(${source});`), source.slice(0, 200));
    }
    assert.equal(
      sent.filter(({ method }) => method === 'Runtime.evaluate').length,
      0,
      'nothing is evaluated in the top page'
    );
  });

  void it('moves mouse events by the frame mapping', async () => {
    const { cdp, sent } = fakeConnection(() => [quad(100, 200, 10, 10)]);
    await frameScopedConnection(cdp, 'element').send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 4,
      y: 6,
    });
    const moved = sent.find(({ method }) => method === 'Input.dispatchMouseEvent');
    assert.deepEqual(moved?.params, { type: 'mouseMoved', x: 104, y: 206 });
  });

  void it('fails a mouse event it cannot place, and measures again on the next one', async () => {
    let available = false;
    const { cdp, sent } = fakeConnection(() => (available ? [quad(100, 200, 10, 10)] : []));
    const scoped = frameScopedConnection(cdp, 'element');
    await assert.rejects(
      scoped.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 }),
      /Cannot place the element's cross-origin iframe/
    );
    assert.equal(sent.filter(({ method }) => method === 'Input.dispatchMouseEvent').length, 0);
    available = true;
    await scoped.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 });
    const pressed = sent.find(({ method }) => method === 'Input.dispatchMouseEvent');
    assert.deepEqual(pressed?.params, { type: 'mousePressed', x: 101, y: 201 });
  });
});

void describe('frame layout boxes', () => {
  void it('intersects boxes, leaving out missing ones', () => {
    assert.deepEqual(
      intersection({ x: 0, y: 0, width: 100, height: 50 }, null, {
        x: 50,
        y: 10,
        width: 100,
        height: 100,
      }),
      { x: 50, y: 10, width: 50, height: 40 }
    );
    assert.deepEqual(
      intersection({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 5, height: 5 }),
      { x: 20, y: 20, width: 0, height: 0 }
    );
  });

  void it('tells whether a box lies inside another', () => {
    const outer = { x: 0, y: 0, width: 100, height: 100 };
    assert.equal(inside({ x: 0, y: 0, width: 100, height: 100 }, outer), true);
    assert.equal(inside({ x: 90, y: 10, width: 20, height: 10 }, outer), false);
  });
});

void describe('placeInOwnerFrame', () => {
  void it('maps the element through the frame and takes the top page and the iframe scroll state', () => {
    const inner = layoutOf('button#accept', geometry(90, 50), { width: 400, height: 200 });
    const owner = layoutOf(
      'iframe#consent',
      geometry(150, 80, { fixed: true, pageScroll: { left: 0, up: 0, right: 0, down: 500 } }),
      { width: 1200, height: 800 }
    );
    const placed = placeInOwnerFrame(inner, owner, PLAIN);
    const [element] = placed.elements;
    assert.deepEqual(placed.page, owner.page);
    assert.deepEqual(element?.geometry.rect, { x: 244, y: 134, width: 80, height: 20 });
    assert.deepEqual(element?.geometry.clip, { x: 154, y: 84, width: 400, height: 200 });
    assert.equal(element?.geometry.fixed, true);
    assert.equal(element?.geometry.pageScroll.down, 500);
    assert.equal(element?.geometry.clipper, null);
    assert.equal(element?.context, 'iframe#consent');
  });

  void it('scales the element and the frame viewport of a scaled frame', () => {
    const inner = layoutOf('button#accept', geometry(90, 50), { width: 400, height: 200 });
    const owner = layoutOf('iframe#scaled', geometry(150, 80), { width: 1200, height: 800 });
    const [element] = placeInOwnerFrame(inner, owner, {
      origin: { x: 165, y: 87 },
      scaleX: 0.5,
      scaleY: 0.5,
    }).elements;
    assert.deepEqual(element?.geometry.rect, { x: 210, y: 112, width: 40, height: 10 });
    assert.deepEqual(element?.geometry.clip, { x: 165, y: 87, width: 200, height: 100 });
  });

  void it('names the iframe as what clips an element outside the frame viewport', () => {
    const inner = layoutOf('a#more', geometry(90, 190), { width: 400, height: 200 });
    const owner = layoutOf('iframe#consent', geometry(150, 80), { width: 1200, height: 800 });
    const [element] = placeInOwnerFrame(inner, owner, PLAIN).elements;
    assert.equal(element?.geometry.clipper, 'iframe#consent');
  });
});
