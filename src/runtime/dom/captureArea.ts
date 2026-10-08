/**
 * The area an element screenshot captures: its border box, grown to what
 * the element paints beyond it (overflowing descendants, text, shadows,
 * outline), plus any `--padding`.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { elementNotVisibleError, elementZeroDimensionsError } from '@/errors/messages.js';
import { resolveNodeInBdgWorld } from '@/runtime/page/bdgWorld.js';
import type { ElementBounds } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/** An element of the page */
export interface ElementRef {
  backendNodeId: number;
}

/** Descendants {@link CONTENT_OVERFLOW_JS} looks at, so a huge element stays cheap */
const OVERFLOW_SCAN_LIMIT = 2000;

/**
 * Page-side distances (CSS px, never negative) by which what an element
 * paints reaches beyond its border box on each side: its rendered
 * descendants (uncleared floats, absolutely positioned and transformed
 * children), its text (descenders past a tight line height, read from its
 * scroll size beyond its client size, in transformed px, to the left on an
 * RTL element), and its own outer box shadows and outline (a focus ring).
 * Descendants of an element that clips its overflow (`overflow` other than
 * `visible`) are cut off by it and not counted, nor are fixed ones (they
 * belong to the viewport) or what lies outside the document (skip links at
 * -9999px). Only the shadows and outline count when the element clips its
 * own overflow.
 */
const CONTENT_OVERFLOW_JS = `function () {
  const view = this.ownerDocument.defaultView;
  const scroller = this.ownerDocument.scrollingElement || this.ownerDocument.documentElement;
  const own = this.getBoundingClientRect();
  const reach = { left: own.left, top: own.top, right: own.right, bottom: own.bottom };
  const page = { left: -view.scrollX, top: -view.scrollY, right: scroller.scrollWidth - view.scrollX, bottom: scroller.scrollHeight - view.scrollY };
  const clips = (style) => style.overflowX !== 'visible' || style.overflowY !== 'visible';
  let budget = ${OVERFLOW_SCAN_LIMIT};
  const walk = (el) => {
    for (const child of el.children) {
      if (--budget < 0) return;
      const style = view.getComputedStyle(child);
      if (style.display === 'none' || style.position === 'fixed') continue;
      const r = child.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && style.visibility === 'visible') {
        reach.left = Math.min(reach.left, Math.max(r.left, page.left));
        reach.top = Math.min(reach.top, Math.max(r.top, page.top));
        reach.right = Math.max(reach.right, Math.min(r.right, page.right));
        reach.bottom = Math.max(reach.bottom, Math.min(r.bottom, page.bottom));
      }
      if (!clips(style)) walk(child);
    }
  };
  const ownStyle = view.getComputedStyle(this);
  if (!clips(ownStyle)) {
    walk(this);
    const scaleX = this.offsetWidth ? own.width / this.offsetWidth : 1;
    const scaleY = this.offsetHeight ? own.height / this.offsetHeight : 1;
    const wider = Math.max(0, this.scrollWidth - this.clientWidth) * scaleX;
    const taller = Math.max(0, this.scrollHeight - this.clientHeight) * scaleY;
    if (ownStyle.direction === 'rtl') reach.left = Math.min(reach.left, own.left - wider);
    else reach.right = Math.max(reach.right, own.right + wider);
    reach.bottom = Math.max(reach.bottom, own.bottom + taller);
  }
  const ink = { left: 0, top: 0, right: 0, bottom: 0 };
  const grow = (side, amount) => { ink[side] = Math.max(ink[side], amount); };
  for (const layer of ownStyle.boxShadow === 'none' ? [] : ownStyle.boxShadow.split(/,(?![^(]*\\))/)) {
    if (/\\binset\\b/.test(layer)) continue;
    const [x = 0, y = 0, blur = 0, spread = 0] = (layer.replace(/(rgba?|hsla?|color|oklch|lab|lch)\\([^)]*\\)/g, '').match(/-?[\\d.]+px/g) || []).map(parseFloat);
    grow('left', blur + spread - x);
    grow('right', blur + spread + x);
    grow('top', blur + spread - y);
    grow('bottom', blur + spread + y);
  }
  if (ownStyle.outlineStyle !== 'none') {
    const outline = parseFloat(ownStyle.outlineWidth) + parseFloat(ownStyle.outlineOffset);
    ['left', 'top', 'right', 'bottom'].forEach((side) => grow(side, outline));
  }
  return {
    left: Math.max(own.left - reach.left, ink.left),
    top: Math.max(own.top - reach.top, ink.top),
    right: Math.max(reach.right - own.right, ink.right),
    bottom: Math.max(reach.bottom - own.bottom, ink.bottom)
  };
}`;

/** Overflow (px) below which the capture keeps to the border box (subpixel rounding) */
const OVERFLOW_SLACK = 1;

/** Measurements so far, naming each one's object group (captures may run side by side) */
let measurements = 0;

/**
 * Throw an element error with exit code 81.
 *
 * @param err - Message and suggestion
 * @throws CommandError (81)
 */
function throwInvalid(err: { message: string; suggestion: string }): never {
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * The border box of an element (padding and border included), relative to
 * the viewport.
 *
 * @param cdp - Session connection
 * @param ref - The element
 * @returns Bounds in CSS px
 * @throws CommandError (81) when it is not rendered or has no area
 */
export async function getElementBounds(
  cdp: CDPConnection,
  ref: ElementRef
): Promise<ElementBounds> {
  const boxModel = await new TypedCDPConnection(cdp)
    .send('DOM.getBoxModel', ref)
    .catch((error: unknown) => {
      log.debug(`No box model: ${getErrorMessage(error)}`);
      return undefined;
    });
  const border = boxModel?.model.border;
  if (!border) throwInvalid(elementNotVisibleError());
  const x = border[0] ?? 0;
  const y = border[1] ?? 0;
  const width = (border[2] ?? 0) - x;
  const height = (border[5] ?? 0) - y;
  if (width <= 0 || height <= 0) throwInvalid(elementZeroDimensionsError());
  return { x, y, width, height };
}

/**
 * Area an element screenshot captures: the border box, grown to the content
 * that overflows it ({@link CONTENT_OVERFLOW_JS}), so floated children are
 * not cropped away.
 *
 * @param cdp - Session connection
 * @param ref - The element
 * @param bounds - Border box (DOM.getBoxModel coordinates)
 * @param padding - Extra space around it (CSS px)
 * @returns The area, or the border box (with the padding) when nothing
 *   overflows (or the page cannot be asked)
 */
export async function captureArea(
  cdp: CDPConnection,
  ref: ElementRef,
  bounds: ElementBounds,
  padding: number
): Promise<ElementBounds> {
  const area = await paintedArea(cdp, ref, bounds);
  return padding > 0
    ? {
        x: area.x - padding,
        y: area.y - padding,
        width: area.width + 2 * padding,
        height: area.height + 2 * padding,
      }
    : area;
}

/**
 * The border box grown to what the element paints beyond it
 * ({@link CONTENT_OVERFLOW_JS}).
 *
 * @param cdp - Session connection
 * @param ref - The element
 * @param bounds - Border box
 * @returns The area
 */
async function paintedArea(
  cdp: CDPConnection,
  ref: ElementRef,
  bounds: ElementBounds
): Promise<ElementBounds> {
  try {
    const overflow = await measureOverflow(cdp, ref);
    if (!overflow) return bounds;
    const [left, top, right, bottom] = ['left', 'top', 'right', 'bottom'].map((side) =>
      Math.max(0, overflow[side] ?? 0)
    ) as [number, number, number, number];
    if (Math.max(left, top, right, bottom) <= OVERFLOW_SLACK) return bounds;
    return {
      x: bounds.x - left,
      y: bounds.y - top,
      width: bounds.width + left + right,
      height: bounds.height + top + bottom,
    };
  } catch (error) {
    log.debug(`Could not measure overflowing content: ${getErrorMessage(error)}`);
    return bounds;
  }
}

/**
 * Run {@link CONTENT_OVERFLOW_JS} on the element in bdg's world.
 *
 * @param cdp - Session connection
 * @param ref - The element
 * @returns Overflow per side, or undefined when the page did not answer
 */
async function measureOverflow(
  cdp: CDPConnection,
  ref: ElementRef
): Promise<Record<string, number> | undefined> {
  const objectGroup = `bdg-screenshot-${++measurements}`;
  try {
    const resolved = await resolveNodeInBdgWorld(cdp, { ...ref, objectGroup });
    const objectId = resolved.object.objectId;
    if (!objectId) return undefined;
    const response = await new TypedCDPConnection(cdp).send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: CONTENT_OVERFLOW_JS,
      returnByValue: true,
    });
    return response.result.value as Record<string, number> | undefined;
  } finally {
    await cdp
      .send('Runtime.releaseObjectGroup', { objectGroup })
      .catch((error: unknown) => log.debug(`Object group not released: ${getErrorMessage(error)}`));
  }
}
