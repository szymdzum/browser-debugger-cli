/**
 * Positions, sizes and visibility of elements (`bdg dom layout`).
 *
 * One page-side pass per command measures every match: its box in page and
 * viewport coordinates (iframe offsets included), what clips it, whether it
 * is rendered, what covers its center and the styles that decide how it
 * shows. The measurements are classified outside the page
 * ({@link classifyViewportPosition}).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { operationFailedError } from '@/errors/messages.js';
import type { DomLayoutCommand } from '@/ipc/protocol/commands.js';
import type {
  ElementLayout,
  LayoutComputedStyle,
  LayoutResult,
  PageLayout,
} from '@/ipc/protocol/domTypes.js';
import {
  ELEMENT_GEOMETRY_JS,
  FRAME_OFFSET_JS,
  VIEWPORT_SIZE_JS,
  classifyViewportPosition,
  type ElementGeometry,
} from '@/runtime/dom/elementGeometry.js';
import {
  ELEMENT_CONTEXT_JS,
  ELEMENT_DESCRIPTION_JS,
  ELEMENT_TEXT_JS,
  textPreview,
} from '@/runtime/dom/elementInfo.js';
import { throwIfInvalidSelector } from '@/runtime/dom/formFillHelpers/shared.js';
import { DEEP_QUERY_JS, missingElementError, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/** Matches measured per command (the rest are counted as omitted) */
export const LAYOUT_ELEMENT_LIMIT = 100;

/**
 * Page-side end of a visible span kept clear of an overlay scrollbar along
 * an edge (16 CSS px wide): overlay scrollbars (macOS, mobile) show for about a
 * second after a scroll and catch hit tests, which then return the scroller.
 * The span ends before the strip when it reaches into it and also shows
 * outside it; without overlay scrollbars along the edge it is unchanged.
 * Arguments: span start and end, the edge, whether overlay scrollbars show there.
 */
export const CLEAR_OF_SCROLLBAR_JS = `(start, end, edge, overlay) =>
  overlay && end > edge - 16 && edge - 16 > start ? edge - 16 : end`;

/**
 * Page-side edges of the top-level viewport with overlay scrollbars: the page
 * scrolls along an axis while its scrollbar takes no space (the window is as
 * wide or tall as the viewport).
 */
const VIEWPORT_OVERLAY_JS = `(view, viewport) => {
  const scroller = view.document.scrollingElement || view.document.documentElement;
  return {
    right: scroller.scrollHeight > viewport.height && view.innerWidth - viewport.width < 1,
    bottom: scroller.scrollWidth > viewport.width && view.innerHeight - viewport.height < 1
  };
}`;

/**
 * Page function: layout of the matches in `found` (all up to `limit`, or the
 * one at `index`) and of the top-level page. An element covers another when
 * it is the topmost element at the center of the largest visible part of the
 * other's boxes (a wrapped link has one per line; the strip where overlay
 * scrollbars show is avoided when possible, {@link CLEAR_OF_SCROLLBAR_JS}) and does not lie inside it. An
 * ancestor covers it only when the ancestor is painted above it there (its
 * `::before`/`::after` overlay, or its background over a negative
 * `z-index`), as `dom click` finds: the element is in the hit-test stack below
 * the ancestor. Hit-testing goes up through the iframes, so an overlay over
 * an iframe covers the elements in it. Elements hit-testing skips
 * (`pointer-events: none`, also through an iframe) get no cover.
 */
const LAYOUT_JS = `function (found, index, limit) {
  const geometryOf = ${ELEMENT_GEOMETRY_JS};
  const viewportSize = ${VIEWPORT_SIZE_JS};
  const frameOffset = ${FRAME_OFFSET_JS};
  const describe = ${ELEMENT_DESCRIPTION_JS};
  const contextOf = ${ELEMENT_CONTEXT_JS};
  const textOf = ${ELEMENT_TEXT_JS};
  const clearOfScrollbar = ${CLEAR_OF_SCROLLBAR_JS};
  const viewportOverlay = ${VIEWPORT_OVERLAY_JS};
  const picked = index === null
    ? found.slice(0, limit).map((el, i) => [i, el])
    : (found[index] ? [[index, found[index]]] : []);
  if (picked.length === 0) return { count: found.length, elements: [] };
  let top = picked[0][1].ownerDocument.defaultView;
  while (top.frameElement) top = top.parent;
  const scroller = top.document.scrollingElement || top.document.documentElement;
  const page = {
    viewport: viewportSize(top),
    scroll: { x: top.scrollX, y: top.scrollY },
    document: { width: scroller.scrollWidth, height: scroller.scrollHeight },
    colorScheme: top.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  };
  const pageOverlay = viewportOverlay(top, page.viewport);
  const encloses = (outer, node) => {
    for (let n = node; n; n = n.parentNode || n.host) if (n === outer) return true;
    return false;
  };
  const coverAt = (node, x, y) => {
    const root = node.getRootNode();
    const scope = typeof root.elementFromPoint === 'function' ? root : node.ownerDocument;
    const hit = scope.elementFromPoint(x, y);
    if (!hit || encloses(node, hit)) return null;
    if (!encloses(hit, node)) return hit;
    return scope.elementsFromPoint(x, y).indexOf(node) > 0 ? hit : null;
  };
  const visibleCenter = (el, g) => {
    const bounds = [{ x: 0, y: 0, width: page.viewport.width, height: page.viewport.height }].concat(g.clip ? [g.clip] : []);
    let best = null;
    for (const r of Array.from(el.getClientRects())) {
      const boxes = bounds.concat([{ x: r.left + g.offset.x, y: r.top + g.offset.y, width: r.width, height: r.height }]);
      const left = Math.max(...boxes.map((b) => b.x));
      const top = Math.max(...boxes.map((b) => b.y));
      const right = Math.min(...boxes.map((b) => b.x + b.width));
      const bottom = Math.min(...boxes.map((b) => b.y + b.height));
      const area = (right - left) * (bottom - top);
      if (!(right > left && bottom > top) || (best && area <= best.area)) continue;
      let clearRight = clearOfScrollbar(left, right, page.viewport.width, pageOverlay.right);
      let clearBottom = clearOfScrollbar(top, bottom, page.viewport.height, pageOverlay.bottom);
      if (g.clip) {
        clearRight = clearOfScrollbar(left, clearRight, g.clip.x + g.clip.width, g.clipOverlay.right);
        clearBottom = clearOfScrollbar(top, clearBottom, g.clip.y + g.clip.height, g.clipOverlay.bottom);
      }
      best = { area: area, x: (left + clearRight) / 2, y: (top + clearBottom) / 2 };
    }
    return best;
  };
  const hitTestable = (node) => node.ownerDocument.defaultView.getComputedStyle(node).pointerEvents !== 'none';
  const coveredBy = (el, g) => {
    const center = hitTestable(el) && visibleCenter(el, g);
    if (!center) return null;
    let x = center.x - g.offset.x;
    let y = center.y - g.offset.y;
    let cover = coverAt(el, x, y);
    for (let view = el.ownerDocument.defaultView; !cover && view.frameElement; view = view.parent) {
      if (!hitTestable(view.frameElement)) return null;
      const offset = frameOffset(view.frameElement);
      x += offset.x;
      y += offset.y;
      cover = coverAt(view.frameElement, x, y);
    }
    return cover ? describe(cover) : null;
  };
  const elements = picked.map(([i, el]) => {
    const style = el.ownerDocument.defaultView.getComputedStyle(el);
    const geometry = geometryOf(el);
    return {
      index: i,
      tag: el.tagName.toLowerCase(),
      element: describe(el),
      text: String(textOf(el)).replace(/\\s+/g, ' ').trim().slice(0, 1000),
      context: contextOf(el),
      geometry: geometry,
      coveredBy: geometry.hidden ? null : coveredBy(el, geometry),
      computed: { display: style.display, visibility: style.visibility, position: style.position, opacity: style.opacity, zIndex: style.zIndex }
    };
  });
  return { count: found.length, page: page, elements: elements };
}`;

/** One element as {@link LAYOUT_JS} measures it. */
export interface RawElementLayout {
  index: number;
  tag: string;
  element: string;
  text: string;
  context: string;
  geometry: ElementGeometry;
  coveredBy: string | null;
  computed: LayoutComputedStyle;
}

/** What {@link LAYOUT_JS} returns. */
export interface RawLayout {
  /** Elements the selector matched */
  count: number;
  /** Set when at least one element was measured */
  page?: PageLayout;
  elements: RawElementLayout[];
}

/** Distinguishes the object groups of concurrent calls */
let groupCounter = 0;

/**
 * Measure the elements a selector (or cached index) refers to.
 *
 * @param cdp - CDP connection
 * @param params - Selector (and index) or backend node id
 * @returns Layout report
 * @throws CommandError (83) no match, (81) index out of range or invalid
 *   selector, (87) the cached element left the page
 */
export async function inspectLayout(
  cdp: CDPConnection,
  params: DomLayoutCommand
): Promise<LayoutResult> {
  const objectGroup = `bdg-layout-${++groupCounter}`;
  try {
    const raw =
      params.backendNodeId === undefined
        ? await measureSelector(cdp, params)
        : await measureNode(cdp, params.backendNodeId, objectGroup);
    if (!raw.page || raw.elements.length === 0) throw missingElementError(params, raw.count);
    return buildLayoutResult({ ...raw, page: raw.page }, params);
  } finally {
    void cdp
      .send('Runtime.releaseObjectGroup', { objectGroup })
      .catch((error: unknown) => log.debug(`Object group not released: ${getErrorMessage(error)}`));
  }
}

/**
 * Measure the matches of a selector (searching open shadow roots and
 * same-origin frames) in one page evaluation.
 *
 * @param cdp - CDP connection
 * @param params - Selector and optional index
 * @returns Measurements
 * @throws CommandError (81) invalid selector, (91) page script failure
 */
async function measureSelector(cdp: CDPConnection, params: DomLayoutCommand): Promise<RawLayout> {
  const found = `(${DEEP_QUERY_JS})(${selectorArgsJS(params.selector)})`;
  const response = (await cdp.send('Runtime.evaluate', {
    expression: `(${LAYOUT_JS})(${found}, ${params.index ?? null}, ${LAYOUT_ELEMENT_LIMIT})`,
    returnByValue: true,
  })) as Protocol.Runtime.EvaluateResponse;
  if (response.exceptionDetails) {
    throwIfInvalidSelector(response.exceptionDetails, params.selector);
    const err = operationFailedError('measure the elements', response.exceptionDetails.text);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SCRIPT_ERROR);
  }
  return response.result.value as RawLayout;
}

/**
 * Measure one exact element (from the query cache).
 *
 * @param cdp - CDP connection
 * @param backendNodeId - Backend node id
 * @param objectGroup - Object group for the handle
 * @returns Measurements; no elements when the node left the page
 */
async function measureNode(
  cdp: CDPConnection,
  backendNodeId: number,
  objectGroup: string
): Promise<RawLayout> {
  const resolved = (await cdp
    .send('DOM.resolveNode', { backendNodeId, objectGroup })
    .catch((error: unknown) => {
      log.debug(`Node ${backendNodeId} not resolved: ${getErrorMessage(error)}`);
      return {};
    })) as Partial<Protocol.DOM.ResolveNodeResponse>;
  const objectId = resolved.object?.objectId;
  if (!objectId) return { count: 0, elements: [] };
  const response = (await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: `function () { return (${LAYOUT_JS})(this.isConnected ? [this] : [], null, 1); }`,
    returnByValue: true,
  })) as Protocol.Runtime.CallFunctionOnResponse;
  return (response.result.value as RawLayout | undefined) ?? { count: 0, elements: [] };
}

/**
 * Turn page-side measurements into the layout report: rounded page and
 * viewport coordinates, viewport position and text preview per element.
 *
 * @param raw - Measurements with at least one element
 * @param params - Request (selector and index)
 * @returns Layout report
 */
export function buildLayoutResult(
  raw: RawLayout & { page: PageLayout },
  params: Pick<DomLayoutCommand, 'selector' | 'index'>
): LayoutResult {
  const omitted = params.index === undefined ? raw.count - raw.elements.length : 0;
  return {
    success: true,
    selector: params.selector,
    count: raw.count,
    page: roundPage(raw.page),
    elements: raw.elements.map((element) => elementLayout(element, raw.page)),
    ...(omitted > 0 && { omitted }),
  };
}

/**
 * Page layout with whole pixels.
 *
 * @param page - Measured page layout
 * @returns Rounded page layout
 */
function roundPage(page: PageLayout): PageLayout {
  return {
    viewport: { width: Math.round(page.viewport.width), height: Math.round(page.viewport.height) },
    scroll: { x: Math.round(page.scroll.x), y: Math.round(page.scroll.y) },
    document: { width: Math.round(page.document.width), height: Math.round(page.document.height) },
    ...(page.colorScheme && { colorScheme: page.colorScheme }),
  };
}

/**
 * Layout of one element.
 *
 * @param raw - Element measurements
 * @param page - Page layout (viewport size and scroll position)
 * @returns Element layout; `coveredBy` only for elements that are in view
 */
function elementLayout(raw: RawElementLayout, page: PageLayout): ElementLayout {
  const { rect } = raw.geometry;
  const placement = classifyViewportPosition(raw.geometry, page.viewport);
  const inView = placement.inViewport === 'visible' || placement.inViewport === 'partly';
  const text = textPreview(raw.text);
  return {
    index: raw.index,
    tag: raw.tag,
    element: raw.element,
    ...(text && { text }),
    ...(raw.context && { context: raw.context }),
    bounds: {
      x: Math.round(rect.x + page.scroll.x),
      y: Math.round(rect.y + page.scroll.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    viewport: { x: Math.round(rect.x), y: Math.round(rect.y) },
    ...placement,
    ...(inView && raw.coveredBy && { coveredBy: raw.coveredBy }),
    ...(raw.geometry.invisible && { invisible: raw.geometry.invisible }),
    ...(raw.geometry.inert && { inert: true }),
    computed: raw.computed,
  };
}
