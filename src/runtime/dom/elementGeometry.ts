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
import { LAYOUT_REASONS, scrollLockedReason } from '@/ui/messages/commands.js';

/** Measurements of one element ({@link ELEMENT_GEOMETRY_JS}). */
export interface ElementGeometry {
  /** Border box in top-level viewport coordinates */
  rect: LayoutBox;
  /** Area its iframes and overflow-clipping ancestors leave visible, in the same coordinates */
  clip: LayoutBox | null;
  /** Whether overlay scrollbars of the clipping containers show along the clip's right and bottom edges */
  clipOverlay: OverlayEdges;
  /** Innermost ancestor or iframe cutting off part of it, e.g. `ul#list` */
  clipper: string | null;
  /** Why it cannot be seen regardless of position, e.g. `display: none`, `clipped by div#acc: zero height` */
  hidden: string | null;
  /**
   * Why it cannot be seen although it is rendered ({@link INVISIBLE_REASON_JS}),
   * e.g. `opacity: 0 on div#menu`
   */
  invisible: string | null;
  /** Inside an `inert` element: shown, but not interactive */
  inert: boolean;
  /** Fixed to the top-level viewport (it or a container is `position: fixed`): page scroll does not move it */
  fixed: boolean;
  /** It or an ancestor is `position: sticky`: page scroll moves it only until it sticks */
  sticky?: boolean;
  /** How far the top-level page can scroll from where it is now */
  pageScroll: ScrollRange;
  /**
   * Why the top-level page cannot scroll although content is below the fold
   * ({@link SCROLL_LOCK_JS}); null when it is not locked
   */
  scrollLock?: ScrollLock | null;
  /** Offset of its document's viewport within the top-level viewport (iframes) */
  offset: LayoutPoint;
}

/** What keeps the top-level page from scrolling ({@link SCROLL_LOCK_JS}). */
export interface ScrollLock {
  /** The styles locking it, e.g. `position: fixed, overflow: hidden on body` */
  by: string;
  /** A visible dialog that is likely the reason, e.g. `div#consent`; null when there is none */
  dialog: string | null;
}

/** Edges of a viewport or clip along which overlay scrollbars (that take no space) show after a scroll. */
export interface OverlayEdges {
  right: boolean;
  bottom: boolean;
}

/** Distances (CSS px, never negative) a page can scroll in each direction. */
export interface ScrollRange {
  left: number;
  up: number;
  right: number;
  down: number;
}

/** How an element relates to the viewport ({@link classifyViewportPosition}). */
export interface ViewportPlacement {
  inViewport: ViewportPosition;
  /** Share in view (1-99), for `partly` */
  percentVisible?: number;
  /** Why it is `hidden` */
  hiddenReason?: string;
  /** Page scroll that brings it into view (centred), when it is not fully in view and the page can scroll there */
  scrollBy?: LayoutPoint;
  /** Ancestor or iframe cutting it off (page scroll alone does not show it) */
  clippedBy?: string;
  /** Why page scroll cannot bring it fully into view ({@link OFF_SCREEN_REASONS}) */
  offScreenReason?: string;
}

/** Why page scroll cannot bring an element that is not fully in view into view. */
export const OFF_SCREEN_REASONS = {
  fixed: 'fixed position, page scroll does not move it',
  sticky: 'sticky position, page scroll moves it only until it sticks',
  outOfRange: "beyond the page's scroll range",
} as const;

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
 * Page-side distances a window's page can scroll in each direction from its
 * current position. Right-to-left pages scroll to negative `scrollX`. Content
 * that a scrolling body cuts off is reported through the body as a clipper.
 */
const SCROLL_RANGE_JS = `(view) => {
  const doc = view.document;
  const scroller = doc.scrollingElement || doc.documentElement;
  const maxX = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  const maxY = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const rtl = view.scrollX < 0 || view.getComputedStyle(doc.documentElement).direction === 'rtl';
  const left = rtl ? maxX + view.scrollX : view.scrollX;
  return { left: Math.max(0, left), up: Math.max(0, view.scrollY), right: Math.max(0, maxX - left), down: Math.max(0, maxY - view.scrollY) };
}`;

/**
 * Page-side reason the page of a window cannot be scrolled although its
 * content may extend below the fold: the scrolling element is no taller than
 * the viewport while the body or root element is `position: fixed` or has
 * `overflow: hidden` (or `clip`), which is how dialogs lock page scrolling,
 * with the first visible dialog of the page (`dialog[open]`,
 * `[aria-modal=true]`, `[role=dialog]`, `[role=alertdialog]`) as the likely
 * reason. Null when the page can scroll or nothing locks it.
 */
const SCROLL_LOCK_JS = `(view, describe) => {
  const doc = view.document;
  const scroller = doc.scrollingElement || doc.documentElement;
  if (scroller.scrollHeight > scroller.clientHeight + 1) return null;
  const lockOf = (node, name) => {
    if (!node) return null;
    const style = view.getComputedStyle(node);
    const parts = [];
    if (style.position === 'fixed') parts.push('position: fixed');
    if (style.overflowY === 'hidden' || style.overflowY === 'clip') parts.push('overflow: ' + style.overflowY);
    return parts.length > 0 ? parts.join(', ') + ' on ' + name : null;
  };
  const by = lockOf(doc.body, 'body') || lockOf(doc.documentElement, 'html');
  if (!by) return null;
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true }));
  };
  const dialogs = doc.querySelectorAll('dialog[open], [aria-modal="true"], [role="dialog"], [role="alertdialog"]');
  const dialog = Array.from(dialogs).find(shown);
  return { by: by, dialog: dialog ? describe(dialog) : null };
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

/** Page-side parent in the flat tree: a slotted node's slot, then its parent, then a shadow root's host. */
const FLAT_PARENT_JS = `(n) => n.assignedSlot || n.parentElement || (n.parentNode && n.parentNode.host) || null`;

/**
 * Page-side test of computed styles: true when they only scale or move the
 * box (no `rotate`, and a 2D `transform` matrix without rotation or skew), so
 * its bounding box is the box itself, scaled.
 */
export const SCALES_ONLY_JS = `(style) => {
  if (style.rotate && style.rotate !== 'none') return false;
  if (!style.transform || style.transform === 'none') return true;
  const matrix = /^matrix\\(([^)]*)\\)$/.exec(style.transform);
  if (!matrix) return false;
  const values = matrix[1].split(',').map(parseFloat);
  return Math.abs(values[1]) < 1e-6 && Math.abs(values[2]) < 1e-6;
}`;

/**
 * Page-side padding box of a clipping container in its document's viewport
 * coordinates. It is scaled by the container's rendered to layout size ratio
 * (`getBoundingClientRect()` against `offsetWidth`/`offsetHeight`), so CSS
 * `zoom` and `transform: scale()` on it or around it clip where they show;
 * when it or an ancestor is rotated or skewed the bounding box is no longer
 * its box, and the unscaled size is used. `clientWidth`/`clientHeight` are
 * whole pixels: a container they report as 0 is measured from its rendered
 * size minus borders, so only one with no area at all counts as collapsed.
 */
const CLIP_BOX_JS = `(p) => {
  const scalesOnly = ${SCALES_ONLY_JS};
  const parentOf = ${FLAT_PARENT_JS};
  const styleOf = (n) => n.ownerDocument.defaultView.getComputedStyle(n);
  let plain = true;
  for (let n = p; n && plain; n = parentOf(n)) plain = scalesOnly(styleOf(n));
  const style = styleOf(p);
  const r = p.getBoundingClientRect();
  const scaleX = plain && p.offsetWidth > 0 ? r.width / p.offsetWidth : 1;
  const scaleY = plain && p.offsetHeight > 0 ? r.height / p.offsetHeight : 1;
  const inner = (client, rendered, borders, scale) =>
    client > 0 ? client * scale : Math.max(0, rendered - borders * scale);
  const width = inner(p.clientWidth, plain ? r.width : p.offsetWidth, parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth), scaleX);
  const height = inner(p.clientHeight, plain ? r.height : p.offsetHeight, parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth), scaleY);
  const left = r.left + p.clientLeft * scaleX;
  const top = r.top + p.clientTop * scaleY;
  return { left: left, top: top, right: left + width, bottom: top + height };
}`;

/**
 * Page-side overlay scrollbars of a clipping container: whether it scrolls
 * along an axis with a scrollbar that takes no space (macOS, mobile), which
 * shows over its right (vertical) or bottom (horizontal) edge after a scroll.
 */
const OVERLAY_SCROLLBARS_JS = `(p) => {
  const style = p.ownerDocument.defaultView.getComputedStyle(p);
  const scrolls = (overflow, content, client) => /auto|scroll/.test(overflow) && content > client;
  const spare = (outer, client, a, b) => outer - client - parseFloat(a) - parseFloat(b) < 1;
  return {
    right: scrolls(style.overflowY, p.scrollHeight, p.clientHeight) && spare(p.offsetWidth, p.clientWidth, style.borderLeftWidth, style.borderRightWidth),
    bottom: scrolls(style.overflowX, p.scrollWidth, p.clientWidth) && spare(p.offsetHeight, p.clientHeight, style.borderTopWidth, style.borderBottomWidth)
  };
}`;

/**
 * Page-side test of whether a container lets a `position: fixed` descendant
 * escape to the viewport: false when it is transformed (or filtered,
 * contained, …) and so holds it like an absolutely positioned one.
 */
const HOLDS_FIXED_JS = `(style) =>
  style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' ||
  /transform|filter|perspective/.test(style.willChange) || /paint|layout|strict|content/.test(style.contain)`;

/**
 * Page-side test of whether a `position: fixed` node is fixed to its
 * document's viewport (no ancestor holds it, {@link HOLDS_FIXED_JS}).
 */
const FIXED_TO_VIEWPORT_JS = `(n) => {
  const holdsFixed = ${HOLDS_FIXED_JS};
  const parentOf = (node) => node.parentElement || (node.parentNode && node.parentNode.host) || null;
  for (let p = parentOf(n); p && p !== n.ownerDocument.documentElement; p = parentOf(p)) {
    if (holdsFixed(p.ownerDocument.defaultView.getComputedStyle(p))) return false;
  }
  return true;
}`;

/**
 * Page-side clip of a node by its ancestors (looked up through open shadow
 * roots): the padding boxes ({@link CLIP_BOX_JS}) of those that cut off
 * overflowing content and hold the node in their containing-block chain. An
 * absolutely positioned node skips static ancestors (that are not
 * transformed) up to its containing block, a fixed one is not clipped at all
 * unless a transformed (or filtered, contained, …) ancestor holds it like an
 * absolute one, and inline ancestors and `display: contents` ones have no box
 * to clip with. The root element is left out (its overflow belongs to the
 * viewport), and so is the body's overflow unless the root element's
 * overflow is not `visible` (then the body keeps its own overflow and, e.g.
 * as the page's scroller, clips like any container).
 * Returns the clip, whether overlay scrollbars of the containers show along
 * its right and bottom edges ({@link OVERLAY_SCROLLBARS_JS}), the innermost
 * ancestor cutting off part of `rect` (null when none does), why the
 * innermost clipping ancestor with no area (a collapsed
 * `height: 0; overflow: hidden` accordion) hides it, e.g.
 * `clipped by div#acc: zero height` (null when none has), and whether the
 * node is fixed to the viewport (it or a container in its containing-block
 * chain is `position: fixed`; `fixedBy` is that node).
 */
const ANCESTOR_CLIP_JS = `(node, rect, describe) => {
  const clipBox = ${CLIP_BOX_JS};
  const overlayScrollbars = ${OVERLAY_SCROLLBARS_JS};
  const holdsFixed = ${HOLDS_FIXED_JS};
  const fixedToViewport = ${FIXED_TO_VIEWPORT_JS};
  const reasons = ${JSON.stringify(LAYOUT_REASONS)};
  const styleOf = (n) => n.ownerDocument.defaultView.getComputedStyle(n);
  const parentOf = (n) => n.parentElement || (n.parentNode && n.parentNode.host) || null;
  const doc = node.ownerDocument;
  const rootStyle = styleOf(doc.documentElement);
  const bodyClips = rootStyle.overflowX !== 'visible' || rootStyle.overflowY !== 'visible';
  const result = { clip: null, overlay: { right: false, bottom: false }, clipper: null, collapsed: null, fixed: false, fixedBy: null };
  const add = (p) => {
    const box = clipBox(p);
    const contains = rect.left >= box.left && rect.top >= box.top && rect.right <= box.right && rect.bottom <= box.bottom;
    if (!result.clipper && !contains) result.clipper = describe(p);
    const empty = box.bottom <= box.top ? reasons.zeroHeight : box.right <= box.left ? reasons.zeroWidth : null;
    if (!result.collapsed && empty) result.collapsed = reasons.clippedBy + describe(p) + ': ' + empty;
    const clip = result.clip || box;
    const bars = overlayScrollbars(p);
    result.overlay = {
      right: box.right < clip.right ? bars.right : box.right > clip.right ? result.overlay.right : result.overlay.right || bars.right,
      bottom: box.bottom < clip.bottom ? bars.bottom : box.bottom > clip.bottom ? result.overlay.bottom : result.overlay.bottom || bars.bottom
    };
    result.clip = { left: Math.max(clip.left, box.left), top: Math.max(clip.top, box.top), right: Math.min(clip.right, box.right), bottom: Math.min(clip.bottom, box.bottom) };
  };
  let position = styleOf(node).position;
  if (position === 'fixed') {
    if (fixedToViewport(node)) return Object.assign(result, { fixed: true, fixedBy: node });
    position = 'absolute';
  }
  for (let p = parentOf(node); p && p !== doc.documentElement; p = parentOf(p)) {
    const style = styleOf(p);
    if (position === 'absolute' && style.position === 'static' && !holdsFixed(style)) continue;
    const boxed = style.display !== 'inline' && style.display !== 'contents' && (bodyClips || p !== doc.body);
    if (boxed && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) add(p);
    position = style.position;
    if (position === 'fixed') {
      if (fixedToViewport(p)) return Object.assign(result, { fixed: true, fixedBy: p });
      position = 'absolute';
    }
  }
  return result;
}`;

/** Page-side test of a `clip-path` that cuts everything away: `inset()` with percentages leaving no area. */
export const CLIP_PATH_CUTS_ALL_JS = `(clipPath) => {
  const inset = /^inset\\(([^)]*)\\)/.exec(clipPath || '');
  const values = inset ? inset[1].split(' round ')[0].trim().split(/\\s+/) : [];
  if (values.length === 0 || values.some((v) => !/%$/.test(v))) return false;
  const [top, right = top, bottom = top, left = right] = values.map(parseFloat);
  return top + bottom >= 100 || left + right >= 100;
}`;

/**
 * Page-side test of a `clip` that cuts everything away: `rect()` with no area
 * on an absolutely positioned or fixed element (the "visually hidden"
 * pattern; `clip` applies to no other element).
 */
export const CLIP_RECT_CUTS_ALL_JS = `(position, clip) => {
  if ((position !== 'absolute' && position !== 'fixed') || !/^rect\\(/.test(clip || '')) return false;
  const edges = (clip.match(/-?[\\d.]+/g) || []).map(Number);
  return edges.length === 4 && (edges[1] <= edges[3] || edges[2] <= edges[0]);
}`;

/**
 * Page-side reason an element that is rendered still cannot be seen: it or an
 * ancestor in the flat tree (slots, shadow hosts, iframes) is fully
 * transparent (`opacity: 0`), or cuts everything away
 * ({@link CLIP_PATH_CUTS_ALL_JS}, {@link CLIP_RECT_CUTS_ALL_JS}). Other
 * `clip-path` shapes are not evaluated. Null when none applies.
 */
const INVISIBLE_REASON_JS = `(el, describe) => {
  const flatParent = ${FLAT_PARENT_JS};
  const clipPathCutsAll = ${CLIP_PATH_CUTS_ALL_JS};
  const clipRectCutsAll = ${CLIP_RECT_CUTS_ALL_JS};
  const reasons = ${JSON.stringify(LAYOUT_REASONS)};
  const parentOf = (n) => flatParent(n) || n.ownerDocument.defaultView.frameElement || null;
  for (let n = el; n; n = parentOf(n)) {
    const style = n.ownerDocument.defaultView.getComputedStyle(n);
    const cause = parseFloat(style.opacity) === 0 ? reasons.transparent
      : clipPathCutsAll(style.clipPath) ? 'clip-path: ' + style.clipPath
      : clipRectCutsAll(style.position, style.clip) ? 'clip: ' + style.clip
      : null;
    if (cause) return n === el ? cause : cause + reasons.on + describe(n);
  }
  return null;
}`;

/**
 * Page-side measurement of an element ({@link ElementGeometry}): its box in
 * top-level viewport coordinates, its clip by ancestors
 * ({@link ANCESTOR_CLIP_JS}) and by the viewports of its iframes, why it
 * cannot be seen at all (not rendered, or inside a clipping container
 * collapsed to zero size), why a rendered one is still invisible
 * ({@link INVISIBLE_REASON_JS}), whether it is inert (an `inert` element
 * around it, through shadow roots) or fixed to the top-level viewport, and how
 * far the top-level page can scroll ({@link SCROLL_RANGE_JS}) or what locks
 * its scrolling ({@link SCROLL_LOCK_JS}). Content of a body fixed to lock the
 * page is not counted as fixed: it is in-flow content the lock holds in place.
 *
 * Rendering is decided by `checkVisibility()`, so content Chrome skips
 * (inside a closed `<details>`, under `content-visibility: hidden`) is hidden
 * although it still has a box. Content skipped by `content-visibility: auto`
 * is not: it is rendered once scrolled near the viewport.
 */
export const ELEMENT_GEOMETRY_JS = `(el) => {
  const viewportSize = ${VIEWPORT_SIZE_JS};
  const frameOffset = ${FRAME_OFFSET_JS};
  const ancestorClip = ${ANCESTOR_CLIP_JS};
  const scrollRange = ${SCROLL_RANGE_JS};
  const scrollLock = ${SCROLL_LOCK_JS};
  const invisibleReason = ${INVISIBLE_REASON_JS};
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const reasons = ${JSON.stringify(LAYOUT_REASONS)};
  const styleOf = (node) => node.ownerDocument.defaultView.getComputedStyle(node);
  const parentOf = (node) => node.parentElement || (node.parentNode && node.parentNode.host) || null;
  const shift = (r, x, y) => r && { left: r.left + x, top: r.top + y, right: r.right + x, bottom: r.bottom + y };
  const intersect = (a, b) => {
    if (!a || !b) return a || b;
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    return { left: left, top: top, right: Math.max(left, Math.min(a.right, b.right)), bottom: Math.max(top, Math.min(a.bottom, b.bottom)) };
  };
  const skippedReason = (node) => {
    if (typeof node.checkVisibility !== 'function' || node.checkVisibility()) return null;
    for (let child = node, p = parentOf(node); p; child = p, p = parentOf(p)) {
      if (p.tagName === 'DETAILS' && !p.open && p.querySelector(':scope > summary') !== child) return 'inside a closed <details>';
      if (styleOf(p).contentVisibility === 'hidden') return 'content-visibility: hidden on ' + describe(p);
    }
    return 'not rendered';
  };
  const hiddenReason = (style, box) => {
    if (style.display === 'none') return 'display: none';
    if (style.display === 'contents') return 'display: contents (no box of its own)';
    if (el.getClientRects().length === 0) {
      return el.tagName === 'OPTION' ? reasons.option : 'not rendered (an ancestor has display: none)';
    }
    const skipped = skippedReason(el);
    if (skipped) return skipped;
    if (style.visibility !== 'visible') return 'visibility: ' + style.visibility;
    if (box.width === 0 || box.height === 0) return 'zero size';
    return null;
  };
  const isSticky = () => {
    for (let n = el; n; n = parentOf(n)) {
      if (styleOf(n).position === 'sticky') return true;
    }
    return false;
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
  let overlay = own.overlay;
  let clipper = own.clipper;
  let fixed = own.fixed;
  let fixedBy = own.fixedBy;
  let hidden = hiddenReason(styleOf(el), box) || own.collapsed;
  let x = 0;
  let y = 0;
  for (let view = el.ownerDocument.defaultView; view && view.frameElement; view = view.parent) {
    const frame = view.frameElement;
    const size = viewportSize(view);
    if (!clipper && (rect.left < 0 || rect.top < 0 || rect.right > size.width || rect.bottom > size.height)) clipper = describe(frame);
    const unframed = clip;
    clip = intersect(clip, { left: 0, top: 0, right: size.width, bottom: size.height });
    overlay = { right: !!unframed && unframed.right <= clip.right && overlay.right, bottom: !!unframed && unframed.bottom <= clip.bottom && overlay.bottom };
    const offset = frameOffset(frame);
    rect = shift(rect, offset.x, offset.y);
    const outer = ancestorClip(frame, rect, describe);
    const inner = shift(clip, offset.x, offset.y);
    clip = intersect(inner, outer.clip);
    overlay = { right: clip.right < inner.right ? outer.overlay.right : overlay.right, bottom: clip.bottom < inner.bottom ? outer.overlay.bottom : overlay.bottom };
    clipper = clipper || outer.clipper;
    fixed = outer.fixed;
    fixedBy = outer.fixedBy;
    hidden = hidden || outer.collapsed;
    x += offset.x;
    y += offset.y;
    if (!hidden && (frame.getClientRects().length === 0 || styleOf(frame).visibility !== 'visible' || skippedReason(frame))) hidden = 'inside a hidden iframe';
  }
  let top = el.ownerDocument.defaultView;
  while (top.frameElement) top = top.parent;
  const toBox = (r) => r && { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
  const invisible = hidden ? null : invisibleReason(el, describe);
  const lock = scrollLock(top, describe);
  if (lock && fixedBy === top.document.body) fixed = false;
  return { rect: toBox(rect), clip: toBox(clip), clipOverlay: overlay, clipper: clipper, hidden: hidden, invisible: invisible, inert: isInert(), fixed: fixed, sticky: !fixed && isSticky(), pageScroll: scrollRange(top), scrollLock: lock, offset: { x: x, y: y } };
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

/** Rounding slack (px) when checking that a span is fully in view */
const IN_VIEW_SLACK = 1;

/**
 * Length of a span that is inside the viewport after a scroll.
 *
 * @param start - Start of the span in viewport coordinates
 * @param size - Length of the span
 * @param viewSize - Length of the viewport
 * @param scroll - Scroll along the axis (negative: back)
 * @returns Visible length (0 when out of view)
 */
function visibleLength(start: number, size: number, viewSize: number, scroll: number): number {
  return Math.max(0, Math.min(start - scroll + size, viewSize) - Math.max(start - scroll, 0));
}

/**
 * Page scroll along one axis that centres a span in the viewport (aligns its
 * start, when it is larger than the viewport), like
 * `bdg dom scroll <selector>`, so sticky headers and fixed footers at the edges do not cover
 * it. Limited to how far the page can scroll; when that is not far enough to
 * show the span fully, no scroll helps.
 *
 * @param start - Start of the span in viewport coordinates
 * @param size - Length of the span
 * @param viewSize - Length of the viewport
 * @param back - How far the page can scroll back (up or left)
 * @param forward - How far the page can scroll forward (down or right)
 * @returns Pixels to scroll (negative: back), 0 when it is fully in view, null
 *   when the page cannot scroll far enough
 */
function axisScroll(
  start: number,
  size: number,
  viewSize: number,
  back: number,
  forward: number
): number | null {
  const fully = Math.min(size, viewSize) - IN_VIEW_SLACK;
  if (visibleLength(start, size, viewSize, 0) >= fully) return 0;
  const target = size > viewSize ? start : start + size / 2 - viewSize / 2;
  const scroll = Math.round(Math.min(forward, Math.max(-back, target))) || 0;
  return visibleLength(start, size, viewSize, scroll) >= fully ? scroll : null;
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
 * otherwise the page scroll, unless the page scroll does not move it (fixed)
 * or not all the way (sticky: the scroll needed cannot be told), or cannot go far enough (it is beyond the scrollable area, or the page does
 * not scroll at all, e.g. locked by a dialog).
 *
 * @param geometry - Page-side measurements
 * @param viewport - Top-level viewport size
 * @returns `clippedBy`, `scrollBy` or `offScreenReason`, or nothing when no
 *   scroll is needed
 */
function outOfViewAdvice(
  geometry: ElementGeometry,
  viewport: LayoutSize
): Pick<ViewportPlacement, 'clippedBy' | 'scrollBy' | 'offScreenReason'> {
  if (geometry.clipper) return { clippedBy: geometry.clipper };
  if (geometry.fixed) return { offScreenReason: OFF_SCREEN_REASONS.fixed };
  if (geometry.sticky) return { offScreenReason: OFF_SCREEN_REASONS.sticky };
  const { rect, pageScroll } = geometry;
  const x = axisScroll(rect.x, rect.width, viewport.width, pageScroll.left, pageScroll.right);
  const y = axisScroll(rect.y, rect.height, viewport.height, pageScroll.up, pageScroll.down);
  if (x === null || y === null) {
    const { scrollLock } = geometry;
    return {
      offScreenReason: scrollLock
        ? scrollLockedReason(scrollLock.by, scrollLock.dialog)
        : OFF_SCREEN_REASONS.outOfRange,
    };
  }
  return x === 0 && y === 0 ? {} : { scrollBy: { x, y } };
}
