/**
 * Run the interaction scripts inside the frame of a cached element that the
 * top page cannot reach.
 *
 * An element from `bdg dom a11y query` may be in a cross-origin iframe that
 * shares the page's process (same site, e.g. a consent dialog served from a
 * subdomain). The top page cannot hold it, so its page scripts run in the
 * element's own frame instead: every `Runtime.evaluate` becomes a
 * `Runtime.callFunctionOn` on the element (which runs in the element's
 * context), and mouse events, whose coordinates the scripts measure in the
 * frame's viewport, are mapped into the top-level viewport
 * ({@link FrameMapping}).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { frameMappingError, type FrameMappingProblem } from '@/errors/messages.js';
import type { LayoutBox, LayoutPoint } from '@/ipc/protocol/domTypes.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** `Runtime.evaluate` parameters that `Runtime.callFunctionOn` takes too */
const SHARED_EVALUATE_PARAMS = [
  'returnByValue',
  'userGesture',
  'awaitPromise',
  'objectGroup',
  'silent',
  'generatePreview',
  'throwOnSideEffect',
  'serializationOptions',
] as const;

/** `Runtime.evaluate` parameters with no `Runtime.callFunctionOn` counterpart */
const UNSUPPORTED_EVALUATE_PARAMS = [
  'timeout',
  'contextId',
  'uniqueContextId',
  'includeCommandLineAPI',
  'replMode',
  'disableBreaks',
  'allowUnsafeEvalBlockedByCSP',
] as const;

/** Slack (CSS px) for rounding when telling a scaled frame from an unscaled one */
const SCALE_SLACK_PX = 0.5;

/**
 * How a point in a frame's viewport maps into the top-level viewport:
 * `top = origin + frame * scale` per axis (the scale is not 1 when the
 * iframe, or an ancestor of it, is scaled with `transform` or `zoom`).
 */
export interface FrameMapping {
  /** Where the frame viewport's (0, 0) lies in the top-level viewport (border and padding included) */
  origin: LayoutPoint;
  scaleX: number;
  scaleY: number;
}

/** A box as the frame and as CDP (top-level viewport) see it */
interface ReferenceBox {
  /** `getBoundingClientRect()` in the frame */
  rect: LayoutBox;
  /** `DOM.getContentQuads` (top-level viewport), each as x1,y1,…,x4,y4 */
  quads: number[][];
}

/**
 * `Runtime.callFunctionOn` parameters that evaluate an expression in the
 * context of the element `objectId` refers to.
 *
 * @param params - `Runtime.evaluate` parameters
 * @param objectId - Remote object of the element
 * @returns Parameters for `Runtime.callFunctionOn`
 * @throws Error for a parameter `Runtime.callFunctionOn` has no counterpart for
 *   (e.g. `timeout`), so it is not dropped silently
 */
export function evaluateOnNodeParams(
  params: Record<string, unknown>,
  objectId: string
): Record<string, unknown> {
  const unsupported = UNSUPPORTED_EVALUATE_PARAMS.filter((key) => params[key] !== undefined);
  if (unsupported.length > 0) {
    throw new Error(`Runtime.evaluate in a frame cannot take ${unsupported.join(', ')}`);
  }
  const shared = Object.fromEntries(
    SHARED_EVALUATE_PARAMS.filter((key) => params[key] !== undefined).map((key) => [
      key,
      params[key],
    ])
  );
  return {
    ...shared,
    objectId,
    functionDeclaration: `function () { return (\n${String(params['expression'])}\n); }`,
  };
}

/**
 * Error for a frame that cannot be placed in the top-level viewport.
 *
 * @param problem - What went wrong
 * @param detail - Underlying error, if any
 * @returns Not found (83) error
 */
function mappingError(problem: FrameMappingProblem, detail?: string): CommandError {
  const err = frameMappingError(problem, detail);
  return new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.RESOURCE_NOT_FOUND
  );
}

/**
 * Whether a quad is an axis-aligned rectangle (not rotated or skewed).
 *
 * @param quad - x1,y1,…,x4,y4 clockwise from the top left
 * @returns True when its edges are horizontal and vertical
 */
function axisAligned(quad: number[]): boolean {
  const [x1, y1, x2, y2, x3, y3, x4, y4] = quad as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const near = (a: number, b: number): boolean => Math.abs(a - b) <= SCALE_SLACK_PX;
  return near(y1, y2) && near(x2, x3) && near(y3, y4) && near(x4, x1);
}

/**
 * Scale along one axis: the length in the top-level viewport over the length
 * in the frame, 1 when they differ by no more than rounding.
 *
 * @param top - Length in the top-level viewport
 * @param frame - Length in the frame
 * @returns Scale factor
 */
function axisScale(top: number, frame: number): number {
  return Math.abs(top - frame) <= SCALE_SLACK_PX ? 1 : top / frame;
}

/**
 * How the frame maps into the top-level viewport, from one box seen both ways.
 *
 * @param box - The reference box in the frame and in the top-level viewport
 * @returns The mapping
 * @throws CommandError (83) when the box has no quads or size, or is rotated or skewed
 */
export function frameMappingFrom(box: ReferenceBox): FrameMapping {
  const { rect, quads } = box;
  if (quads.length === 0 || quads.some((quad) => quad.length !== 8)) throw mappingError('no-box');
  if (rect.width <= 0 || rect.height <= 0) throw mappingError('no-box');
  if (!quads.every(axisAligned)) throw mappingError('rotated');
  const xs = quads.flatMap((quad) => quad.filter((_, i) => i % 2 === 0));
  const ys = quads.flatMap((quad) => quad.filter((_, i) => i % 2 === 1));
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const scaleX = axisScale(Math.max(...xs) - left, rect.width);
  const scaleY = axisScale(Math.max(...ys) - top, rect.height);
  return { origin: { x: left - rect.x * scaleX, y: top - rect.y * scaleY }, scaleX, scaleY };
}

/**
 * Map a point of the frame's viewport into the top-level viewport.
 *
 * @param mapping - Frame mapping
 * @param point - Point in the frame's viewport
 * @returns Point in the top-level viewport
 */
export function mapPoint(mapping: FrameMapping, point: LayoutPoint): LayoutPoint {
  return {
    x: mapping.origin.x + point.x * mapping.scaleX,
    y: mapping.origin.y + point.y * mapping.scaleY,
  };
}

/**
 * Map a box of the frame's viewport into the top-level viewport.
 *
 * @param mapping - Frame mapping
 * @param box - Box in the frame's viewport
 * @returns Box in the top-level viewport
 */
export function mapBox(mapping: FrameMapping, box: LayoutBox): LayoutBox {
  return {
    ...mapPoint(mapping, box),
    width: box.width * mapping.scaleX,
    height: box.height * mapping.scaleY,
  };
}

/**
 * Page-side choice of the box to measure: the element's, or its document's
 * root element when the element has no size (hidden, collapsed).
 */
const REFERENCE_NODE_FUNCTION = `function () {
  const r = this.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? this : this.ownerDocument.documentElement;
}`;

/** Page-side `getBoundingClientRect()` as a plain box */
const CLIENT_RECT_FUNCTION =
  'function () { const r = this.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; }';

/**
 * Measure a box of the element's frame both in the frame and through CDP.
 *
 * @param cdp - CDP connection
 * @param objectId - Remote object of the element
 * @returns The reference box
 * @throws CommandError (83) when it cannot be read
 */
async function measureReferenceBox(cdp: CDPConnection, objectId: string): Promise<ReferenceBox> {
  try {
    const reference = (await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: REFERENCE_NODE_FUNCTION,
    })) as Protocol.Runtime.CallFunctionOnResponse;
    const referenceId = reference.result.objectId;
    if (!referenceId) throw mappingError('no-box');
    const [quads, rect] = await Promise.all([
      cdp.send('DOM.getContentQuads', {
        objectId: referenceId,
      }) as Promise<Protocol.DOM.GetContentQuadsResponse>,
      cdp.send('Runtime.callFunctionOn', {
        objectId: referenceId,
        functionDeclaration: CLIENT_RECT_FUNCTION,
        returnByValue: true,
      }) as Promise<{ result?: { value?: LayoutBox } }>,
    ]);
    const box = rect.result?.value;
    if (!box) throw mappingError('no-box');
    return { rect: box, quads: quads.quads };
  } catch (error) {
    if (error instanceof CommandError) throw error;
    throw mappingError('unreadable', getErrorMessage(error));
  }
}

/**
 * How the element's frame maps into the top-level viewport.
 *
 * @param cdp - CDP connection
 * @param objectId - Remote object of the element
 * @returns The mapping
 * @throws CommandError (83) when the frame cannot be measured or is rotated or skewed
 */
export async function measureFrameMapping(
  cdp: CDPConnection,
  objectId: string
): Promise<FrameMapping> {
  return frameMappingFrom(await measureReferenceBox(cdp, objectId));
}

/**
 * A view of the session's connection whose page scripts run in the frame of
 * one element and whose mouse events land on that frame.
 *
 * The mapping is measured at the first mouse event (after the scripts scrolled
 * the element into view) and kept for the rest of the action; a failed
 * measurement is not kept (the next event measures again) and fails the event.
 *
 * @param cdp - Session connection
 * @param objectId - Remote object of the element
 * @returns Connection to hand to the interaction functions
 */
export function frameScopedConnection(cdp: CDPConnection, objectId: string): CDPConnection {
  let mapping: Promise<FrameMapping> | undefined;
  const measured = (): Promise<FrameMapping> => {
    mapping ??= measureFrameMapping(cdp, objectId).catch((error: unknown) => {
      mapping = undefined;
      throw error;
    });
    return mapping;
  };
  const send = async (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string
  ): Promise<unknown> => {
    if (sessionId !== undefined) return cdp.send(method, params, sessionId);
    if (method === 'Runtime.evaluate') {
      return cdp.send('Runtime.callFunctionOn', evaluateOnNodeParams(params, objectId));
    }
    if (method === 'Input.dispatchMouseEvent') {
      const point = mapPoint(await measured(), { x: Number(params['x']), y: Number(params['y']) });
      return cdp.send(method, { ...params, ...point });
    }
    return cdp.send(method, params);
  };
  return new Proxy(cdp, {
    get(target, property): unknown {
      if (property === 'send') return send;
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
