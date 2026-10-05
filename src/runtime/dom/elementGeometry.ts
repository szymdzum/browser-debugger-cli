/**
 * Where elements are relative to the viewport of the top-level page.
 *
 * The page-side scripts measure an element in top-level viewport coordinates
 * (adding the offsets of the same-origin iframes it is in) together with what
 * clips it: the viewports of those iframes and ancestors that cut off
 * overflowing content (scroll containers, `overflow: hidden`). Classifying the
 * measurements is done here, outside the page, so `dom query` and `dom layout`
 * agree and the rules can be tested without a browser.
 */

import type { LayoutBox, LayoutPoint, LayoutSize } from '@/ipc/protocol/domTypes.js';
import { ELEMENT_DESCRIPTION_JS } from '@/runtime/dom/elementInfo.js';
import type { ViewportPosition } from '@/types.js';

/** Measurements of one element ({@link ELEMENT_GEOMETRY_JS}). */
export interface ElementGeometry {
  /** Border box in top-level viewport coordinates */
  rect: LayoutBox;
  /** Area its iframes and overflow-clipping ancestors leave visible, in the same coordinates */
  clip: LayoutBox | null;
  /** Innermost ancestor or iframe cutting off part of it, e.g. `ul#list` */
  clipper: string | null;
  /** Why it cannot be seen regardless of position, e.g. `display: none` */
  hidden: string | null;
  /** Inside an `inert` element: shown, but not interactive */
  inert: boolean;
  /** Offset of its document's viewport within the top-level viewport (iframes) */
  offset: LayoutPoint;
}

/** How an element relates to the viewport ({@link classifyViewportPosition}). */
export interface ViewportPlacement {
  inViewport: ViewportPosition;
  /** Share in view (1-99), for `partly` */
  percentVisible?: number;
  /** Why it is `hidden` */
  hiddenReason?: string;
  /** Page scroll that brings it fully into view, when it is outside the viewport and not clipped */
  scrollBy?: LayoutPoint;
  /** Ancestor or iframe cutting it off (page scroll alone does not show it) */
  clippedBy?: string;
}

/** Edges of a box. */
interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * Page-side size of a window's viewport without scrollbars (the window size
 * for quirks-mode documents, whose root element is as large as the content).
 */
export const VIEWPORT_SIZE_JS = `(view) => {
  const root = view.document.documentElement;
  const standards = view.document.compatMode === 'CSS1Compat' && root;
  return {
    width: standards ? root.clientWidth : view.innerWidth,
    height: standards ? root.clientHeight : view.innerHeight
  };
}`;

/**
 * Page-side offset of an iframe's content (inside its border and padding)
 * within the viewport of the document holding the iframe.
 */
export const FRAME_OFFSET_JS = `(frame) => {
  const rect = frame.getBoundingClientRect();
  const style = frame.ownerDocument.defaultView.getComputedStyle(frame);
  return {
    x: rect.left + frame.clientLeft + parseFloat(style.paddingLeft),
    y: rect.top + frame.clientTop + parseFloat(style.paddingTop)
  };
}`;

/**
 * Page-side clip of a node by its ancestors (looked up through open shadow
 * roots): the padding boxes of those that cut off overflowing content and
 * hold the node in their containing-block chain. An absolutely positioned
 * node skips static ancestors (that are not transformed) up to its containing
 * block, a fixed one is not clipped at all, and inline ancestors and
 * `display: contents` ones have no box to clip with. The root element and body
 * are left out (their overflow belongs to the viewport). Returns the clip and
 * the innermost ancestor cutting off part of `rect` (null when none does).
 */
const ANCESTOR_CLIP_JS = `(node, rect, describe) => {
  const styleOf = (n) => n.ownerDocument.defaultView.getComputedStyle(n);
  const parentOf = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const doc = node.ownerDocument;
  let position = styleOf(node).position;
  let clip = null;
  let clipper = null;
  if (position === 'fixed') return { clip: null, clipper: null };
  for (let p = parentOf(node); p && p !== doc.body && p !== doc.documentElement; p = parentOf(p)) {
    const style = styleOf(p);
    if (position === 'absolute' && style.position === 'static' && style.transform === 'none') continue;
    const boxed = style.display !== 'inline' && style.display !== 'contents';
    if (boxed && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) {
      const r = p.getBoundingClientRect();
      const left = r.left + p.clientLeft;
      const top = r.top + p.clientTop;
      const box = { left: left, top: top, right: left + p.clientWidth, bottom: top + p.clientHeight };
      const contains = rect.left >= box.left && rect.top >= box.top && rect.right <= box.right && rect.bottom <= box.bottom;
      if (!clipper && !contains) clipper = describe(p);
      clip = clip ? { left: Math.max(clip.left, box.left), top: Math.max(clip.top, box.top), right: Math.min(clip.right, box.right), bottom: Math.min(clip.bottom, box.bottom) } : box;
    }
    position = style.position;
    if (position === 'fixed') break;
  }
  return { clip: clip, clipper: clipper };
}`;

/**
 * Page-side measurement of an element ({@link ElementGeometry}): its box in
 * top-level viewport coordinates, its clip by ancestors
 * ({@link ANCESTOR_CLIP_JS}) and by the viewports of its iframes, why it
 * cannot be seen at all (if so) and whether it is inert (an `inert` element
 * around it, through shadow roots).
 */
export const ELEMENT_GEOMETRY_JS = `(el) => {
  const viewportSize = ${VIEWPORT_SIZE_JS};
  const frameOffset = ${FRAME_OFFSET_JS};
  const ancestorClip = ${ANCESTOR_CLIP_JS};
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const styleOf = (node) => node.ownerDocument.defaultView.getComputedStyle(node);
  const shift = (r, x, y) => r && { left: r.left + x, top: r.top + y, right: r.right + x, bottom: r.bottom + y };
  const intersect = (a, b) => {
    if (!a || !b) return a || b;
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    return { left: left, top: top, right: Math.max(left, Math.min(a.right, b.right)), bottom: Math.max(top, Math.min(a.bottom, b.bottom)) };
  };
  const hiddenReason = (style, box) => {
    if (style.display === 'none') return 'display: none';
    if (style.display === 'contents') return 'display: contents (no box of its own)';
    if (el.getClientRects().length === 0) return 'not rendered (an ancestor has display: none)';
    if (style.visibility !== 'visible') return 'visibility: ' + style.visibility;
    if (box.width === 0 || box.height === 0) return 'zero size';
    return null;
  };
  const isInert = () => {
    for (let n = el; n; n = n.parentElement || (n.getRootNode() && n.getRootNode().host) || null) {
      if (n.hasAttribute('inert')) return true;
    }
    return false;
  };
  const box = el.getBoundingClientRect();
  let rect = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
  const own = ancestorClip(el, rect, describe);
  let clip = own.clip;
  let clipper = own.clipper;
  let hidden = hiddenReason(styleOf(el), box);
  let x = 0;
  let y = 0;
  for (let view = el.ownerDocument.defaultView; view && view.frameElement; view = view.parent) {
    const frame = view.frameElement;
    const size = viewportSize(view);
    if (!clipper && (rect.left < 0 || rect.top < 0 || rect.right > size.width || rect.bottom > size.height)) clipper = describe(frame);
    clip = intersect(clip, { left: 0, top: 0, right: size.width, bottom: size.height });
    const offset = frameOffset(frame);
    rect = shift(rect, offset.x, offset.y);
    const outer = ancestorClip(frame, rect, describe);
    clip = intersect(shift(clip, offset.x, offset.y), outer.clip);
    clipper = clipper || outer.clipper;
    x += offset.x;
    y += offset.y;
    if (!hidden && (frame.getClientRects().length === 0 || styleOf(frame).visibility !== 'visible')) hidden = 'inside a hidden iframe';
  }
  const toBox = (r) => r && { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  return { rect: toBox(rect), clip: toBox(clip), clipper: clipper, hidden: hidden, inert: isInert(), offset: { x: x, y: y } };
}`;

/**
 * Edges of a box.
 *
 * @param box - Position and size
 * @returns Its edges
 */
function edgesOf(box: LayoutBox): Edges {
  return { left: box.x, top: box.y, right: box.x + box.width, bottom: box.y + box.height };
}

/**
 * Area of the overlap of two boxes.
 *
 * @param a - First box
 * @param b - Second box
 * @returns Overlap, or null when they do not overlap
 */
function overlap(a: Edges, b: Edges): Edges | null {
  const result = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return result.right > result.left && result.bottom > result.top ? result : null;
}

/**
 * The direction in which a box lies entirely outside another, vertical first
 * (pages mostly scroll vertically).
 *
 * @param rect - Element box
 * @param view - Visible area
 * @returns Direction, or null when they overlap on both axes
 */
function directionOutside(rect: Edges, view: Edges): ViewportPosition | null {
  if (rect.bottom <= view.top) return 'above';
  if (rect.top >= view.bottom) return 'below';
  if (rect.right <= view.left) return 'left';
  if (rect.left >= view.right) return 'right';
  return null;
}

/**
 * Scroll along one axis that brings a span fully into view (its start, when
 * it is larger than the view).
 *
 * @param start - Start of the span in viewport coordinates
 * @param size - Length of the span
 * @param viewSize - Length of the viewport
 * @returns Pixels to scroll (negative: back), 0 when it is in view
 */
function axisScroll(start: number, size: number, viewSize: number): number {
  if (start < 0) return Math.round(start);
  const overflow = start + size - viewSize;
  return overflow > 0 ? Math.round(Math.min(start, overflow)) : 0;
}

/**
 * Page scroll that brings an element fully into view.
 *
 * @param rect - Element box in viewport coordinates
 * @param viewport - Viewport size
 * @returns Scroll amounts, or undefined when no page scroll is needed
 */
function scrollIntoView(rect: LayoutBox, viewport: LayoutSize): LayoutPoint | undefined {
  const x = axisScroll(rect.x, rect.width, viewport.width);
  const y = axisScroll(rect.y, rect.height, viewport.height);
  return x === 0 && y === 0 ? undefined : { x, y };
}

/**
 * Classify where an element is relative to the top-level viewport.
 *
 * Visible parts are what lies inside the viewport and the element's clip
 * (iframes, overflow containers). An element with no visible part is `above`,
 * `below`, `left` or `right` of the viewport (or of its clip, e.g. scrolled
 * out of a list), and `hidden` when it is not rendered at all. Being inert
 * does not change the position: inert elements are shown.
 *
 * @param geometry - Page-side measurements
 * @param viewport - Top-level viewport size
 * @returns Position, with the visible share, hidden reason, clipping
 *   ancestor or page scroll when relevant
 */
export function classifyViewportPosition(
  geometry: ElementGeometry,
  viewport: LayoutSize
): ViewportPlacement {
  if (geometry.hidden) return { inViewport: 'hidden', hiddenReason: geometry.hidden };
  const rect = edgesOf(geometry.rect);
  const screen = edgesOf({ x: 0, y: 0, ...viewport });
  const view = geometry.clip ? overlap(screen, edgesOf(geometry.clip)) : screen;
  const seen = view && overlap(rect, view);
  const advice = outOfViewAdvice(geometry, viewport);
  if (!seen) {
    const direction =
      directionOutside(rect, screen) ??
      (geometry.clip && directionOutside(rect, edgesOf(geometry.clip)));
    if (!direction) {
      return {
        inViewport: 'hidden',
        hiddenReason: `clipped by ${geometry.clipper ?? 'an ancestor'}`,
      };
    }
    return { inViewport: direction, ...advice };
  }
  const area = (seen.right - seen.left) * (seen.bottom - seen.top);
  const share = (area / (geometry.rect.width * geometry.rect.height)) * 100;
  if (share >= 99.5) return { inViewport: 'visible' };
  const percentVisible = Math.min(99, Math.max(1, Math.round(share)));
  return { inViewport: 'partly', percentVisible, ...advice };
}

/**
 * What brings a not fully visible element into view: the ancestor or iframe
 * cutting it off when there is one (page scroll alone would not help),
 * otherwise the page scroll.
 *
 * @param geometry - Page-side measurements
 * @param viewport - Top-level viewport size
 * @returns `clippedBy` or `scrollBy`, or nothing when neither applies
 */
function outOfViewAdvice(
  geometry: ElementGeometry,
  viewport: LayoutSize
): Pick<ViewportPlacement, 'clippedBy' | 'scrollBy'> {
  if (geometry.clipper) return { clippedBy: geometry.clipper };
  const scrollBy = scrollIntoView(geometry.rect, viewport);
  return scrollBy ? { scrollBy } : {};
}
