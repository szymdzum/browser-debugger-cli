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
 * frame's viewport, are moved by the frame's offset in the top-level viewport.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** `Runtime.evaluate` parameters that `Runtime.callFunctionOn` takes too */
const SHARED_EVALUATE_PARAMS = [
  'returnByValue',
  'userGesture',
  'awaitPromise',
  'objectGroup',
  'silent',
  'generatePreview',
] as const;

/** Offset of a point in the frame's viewport from the same point in the top-level viewport */
export interface FrameOffset {
  x: number;
  y: number;
}

/**
 * `Runtime.callFunctionOn` parameters that evaluate an expression in the
 * context of the element `objectId` refers to.
 *
 * @param params - `Runtime.evaluate` parameters
 * @param objectId - Remote object of the element
 * @returns Parameters for `Runtime.callFunctionOn`
 */
export function evaluateOnNodeParams(
  params: Record<string, unknown>,
  objectId: string
): Record<string, unknown> {
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
 * Where the element's frame lies in the top-level viewport: the element's
 * box as CDP reports it (top-level coordinates) minus its box as the frame
 * measures it.
 *
 * @param cdp - CDP connection
 * @param objectId - Remote object of the element
 * @returns Offset, zero when it cannot be measured
 */
export async function measureFrameOffset(
  cdp: CDPConnection,
  objectId: string
): Promise<FrameOffset> {
  try {
    const [quads, rect] = await Promise.all([
      cdp.send('DOM.getContentQuads', {
        objectId,
      }) as Promise<Protocol.DOM.GetContentQuadsResponse>,
      cdp.send('Runtime.callFunctionOn', {
        objectId,
        functionDeclaration:
          'function () { const r = this.getBoundingClientRect(); return { x: r.left, y: r.top }; }',
        returnByValue: true,
      }) as Promise<{ result?: { value?: FrameOffset } }>,
    ]);
    const xs = quads.quads.flatMap((quad) => quad.filter((_, i) => i % 2 === 0));
    const ys = quads.quads.flatMap((quad) => quad.filter((_, i) => i % 2 === 1));
    const inFrame = rect.result?.value;
    if (xs.length === 0 || !inFrame) return { x: 0, y: 0 };
    return { x: Math.min(...xs) - inFrame.x, y: Math.min(...ys) - inFrame.y };
  } catch (error) {
    log.debug(`Frame offset not measured: ${getErrorMessage(error)}`);
    return { x: 0, y: 0 };
  }
}

/**
 * A view of the session's connection whose page scripts run in the frame of
 * one element and whose mouse events land on that frame.
 *
 * The offset is measured at the first mouse event (after the scripts scrolled
 * the element into view) and kept for the rest of the action.
 *
 * @param cdp - Session connection
 * @param objectId - Remote object of the element
 * @returns Connection to hand to the interaction functions
 */
export function frameScopedConnection(cdp: CDPConnection, objectId: string): CDPConnection {
  let offset: Promise<FrameOffset> | undefined;
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
      offset ??= measureFrameOffset(cdp, objectId);
      const { x, y } = await offset;
      return cdp.send(method, {
        ...params,
        x: Number(params['x']) + x,
        y: Number(params['y']) + y,
      });
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
