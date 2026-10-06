/**
 * Layout of an element inside a cross-origin iframe that shares the page's
 * process (an a11y query can return those).
 *
 * The element is measured in its own frame, whose scripts cannot see the top
 * page, so its measurements are relative to the frame's viewport. The
 * iframe element holding the frame is measured in its own document, and the
 * element is placed in the top-level viewport through it: mapped by the
 * frame's position and scale, clipped to the frame's viewport and to what clips the
 * iframe, and fixed, scrolled or hidden as the iframe is.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import type { LayoutBox } from '@/ipc/protocol/domTypes.js';
import { mapBox, type FrameMapping } from '@/runtime/dom/frameScopedConnection.js';
import type { RawLayout } from '@/runtime/dom/layout.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/**
 * Ids of all frames below a frame tree's root.
 *
 * @param tree - Frame tree
 * @returns Frame ids, depth-first
 */
export function childFrameIds(tree: Protocol.Page.FrameTree | undefined): string[] {
  return (tree?.childFrames ?? []).flatMap((child) => [child.frame.id, ...childFrameIds(child)]);
}

/**
 * Backend node id of the document holding an element.
 *
 * @param cdp - CDP connection
 * @param objectId - Remote object of the element
 * @returns The document's backend node id, if it could be read
 */
async function ownerDocumentId(cdp: CDPConnection, objectId: string): Promise<number | undefined> {
  const doc = (await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function () { return this.ownerDocument; }',
  })) as Protocol.Runtime.CallFunctionOnResponse;
  if (!doc.result.objectId) return undefined;
  const { node } = (await cdp.send('DOM.describeNode', {
    objectId: doc.result.objectId,
  })) as Protocol.DOM.DescribeNodeResponse;
  return node.backendNodeId;
}

/**
 * The iframe element whose document holds an element.
 *
 * @param cdp - CDP connection
 * @param objectId - Remote object of the element
 * @returns Backend node id of the iframe element, undefined when not found
 */
export async function findFrameOwner(
  cdp: CDPConnection,
  objectId: string
): Promise<number | undefined> {
  try {
    const documentId = await ownerDocumentId(cdp, objectId);
    const { frameTree } = (await cdp.send(
      'Page.getFrameTree'
    )) as Protocol.Page.GetFrameTreeResponse;
    for (const frameId of childFrameIds(frameTree)) {
      const owner = (await cdp.send('DOM.getFrameOwner', {
        frameId,
      })) as Protocol.DOM.GetFrameOwnerResponse;
      const { node } = (await cdp.send('DOM.describeNode', {
        backendNodeId: owner.backendNodeId,
      })) as Protocol.DOM.DescribeNodeResponse;
      if (node.contentDocument?.backendNodeId === documentId) return owner.backendNodeId;
    }
  } catch (error) {
    log.debug(`Frame owner not found: ${getErrorMessage(error)}`);
  }
  return undefined;
}

/**
 * Overlap of boxes.
 *
 * @param boxes - Boxes (null ones are left out)
 * @returns Overlap (zero size when they do not overlap)
 */
export function intersection(...boxes: Array<LayoutBox | null>): LayoutBox {
  const present = boxes.filter((box): box is LayoutBox => box !== null);
  const left = Math.max(...present.map((box) => box.x));
  const top = Math.max(...present.map((box) => box.y));
  const right = Math.min(...present.map((box) => box.x + box.width));
  const bottom = Math.min(...present.map((box) => box.y + box.height));
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Whether a box lies inside another.
 *
 * @param inner - Inner box
 * @param outer - Outer box
 * @returns True when it does
 */
export function inside(inner: LayoutBox, outer: LayoutBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/**
 * Place an element measured inside a cross-origin frame in the top-level
 * viewport, through the measurements of the frame's iframe element: mapped by
 * the frame's position and scale (border, padding, `transform`, `zoom`),
 * clipped to the frame's viewport and to what clips the iframe.
 *
 * @param raw - The element, measured in its frame
 * @param owner - The iframe element, measured in its document
 * @param mapping - How the frame's viewport maps into the top-level viewport
 * @returns The element's layout in the top-level page (unchanged when the
 *   iframe could not be measured)
 */
export function placeInOwnerFrame(
  raw: RawLayout,
  owner: RawLayout,
  mapping: FrameMapping
): RawLayout {
  const frame = owner.elements[0];
  if (!raw.page || !owner.page || !frame) return raw;
  const frameView = mapBox(mapping, { x: 0, y: 0, ...raw.page.viewport });
  const elements = raw.elements.map((element) => {
    const inner = element.geometry;
    const outer = frame.geometry;
    const rect = mapBox(mapping, inner.rect);
    const ownClip = inner.clip ? mapBox(mapping, inner.clip) : null;
    return {
      ...element,
      context: [frame.element, element.context].filter(Boolean).join(' > '),
      geometry: {
        ...inner,
        rect,
        clip: intersection(ownClip, frameView, outer.clip),
        clipper: inner.clipper ?? (inside(rect, frameView) ? outer.clipper : frame.element),
        hidden: inner.hidden ?? (outer.hidden ? 'inside a hidden iframe' : null),
        invisible: inner.invisible ?? outer.invisible,
        masked: inner.invisible ? null : (inner.masked ?? outer.masked ?? null),
        fixed: outer.fixed,
        sticky: outer.sticky ?? false,
        pageScroll: outer.pageScroll,
        scrollLock: outer.scrollLock ?? null,
        offset: mapping.origin,
      },
    };
  });
  return { ...raw, page: owner.page, elements, crossOriginFrame: false };
}
