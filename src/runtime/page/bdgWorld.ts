/**
 * bdg's own JavaScript world in the page (a CDP isolated world): it shares
 * the DOM with the page but has its own built-ins, so a page that replaces
 * `Element.prototype.querySelectorAll`, `JSON.stringify` or
 * `Array.prototype.map` (polyfills, old frameworks, anti-bot scripts) cannot
 * change what bdg's page scripts find or return.
 *
 * Only the entry points need the world: `Runtime.evaluate` runs in it with
 * its `contextId`, a page function called on no object runs in it with its
 * `executionContextId` (its parameters are the call's arguments), and
 * `DOM.resolveNode` hands out objects of it with its `executionContextId`;
 * `Runtime.callFunctionOn` on such an object runs in the same world. The world belongs to the top frame (same-origin iframes are
 * reached through it); a node of another frame, a connection without the
 * Page domain (a frame-scoped one) or a failure to create it fall back to the
 * main world, as before.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPProtocolError } from '@/connection/errors.js';
import {
  sendTyped,
  type CommandParams,
  type CommandReturn,
  type Protocol,
} from '@/connection/typed-cdp.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('cdp');

/**
 * What the world needs of a connection: commands, and events to forget the
 * world when the page navigates (a sender without events, such as a test
 * double, runs scripts in the main world)
 */
type PageConnection = Pick<CDPConnection, 'send'> & Partial<Pick<CDPConnection, 'on'>>;

/** Commands that can run in bdg's world */
type WorldMethod = 'Runtime.evaluate' | 'DOM.resolveNode' | 'Runtime.callFunctionOn';

/** Name of bdg's isolated world (shown in DevTools' context selector) */
export const BDG_WORLD_NAME = 'bdg';

/** Errors of a context that is gone (navigation, reload) */
const CONTEXT_GONE = /Cannot find context with specified id|Execution context was destroyed/;

/** The world's context id per connection, until the page navigates */
const worlds = new WeakMap<PageConnection, Promise<number | null>>();

/**
 * The execution context id of bdg's world in the top frame, created on first
 * use and forgotten when the top frame navigates or its contexts are cleared.
 *
 * @param cdp - Connection to the page
 * @returns Context id, or null when no world can be made on this connection
 */
function worldContext(cdp: PageConnection): Promise<number | null> {
  const known = worlds.get(cdp);
  if (known) return known;
  const created = createWorld(cdp);
  worlds.set(cdp, created);
  return created;
}

/**
 * Whether bdg's world is known for a connection: created or being created,
 * and not forgotten since (the top frame navigated, or its contexts were
 * cleared). Scripts left in a forgotten world went with its document.
 *
 * @param cdp - Connection to the page
 * @returns True while the world is known
 */
export function hasBdgWorld(cdp: PageConnection): boolean {
  return worlds.has(cdp);
}

/**
 * Create the world in the top frame and forget it when the page changes.
 *
 * @param cdp - Connection to the page
 * @returns Context id, or null when it cannot be created
 */
async function createWorld(cdp: PageConnection): Promise<number | null> {
  const { on } = cdp;
  if (!on) return null;
  try {
    const { frameTree } = await sendTyped(cdp, 'Page.getFrameTree');
    const { executionContextId } = await sendTyped(cdp, 'Page.createIsolatedWorld', {
      frameId: frameTree.frame.id,
      worldName: BDG_WORLD_NAME,
      grantUniveralAccess: false,
    });
    const forget = (): void => {
      if (worlds.get(cdp) === created) worlds.delete(cdp);
      stopNavigated();
      stopCleared();
    };
    const created = worlds.get(cdp);
    const stopNavigated = on.call(cdp, 'Page.frameNavigated', (params) => {
      if ((params as Protocol.Page.FrameNavigatedEvent).frame.parentId === undefined) forget();
    });
    const stopCleared = on.call(cdp, 'Runtime.executionContextsCleared', forget);
    return executionContextId;
  } catch (error) {
    log.debug(`bdg's isolated world not available: ${getErrorMessage(error)}`);
    worlds.delete(cdp);
    return null;
  }
}

/**
 * Send a command with the world's context, once more with a new world when
 * the context is gone, and in the main world when there is none.
 *
 * @param cdp - Connection to the page
 * @param method - CDP method
 * @param params - Its parameters
 * @param withContext - The parameters with the world's context id
 * @param inMainWorld - Sends the command in the main world (by default as it is)
 * @returns The command's result
 */
async function sendInWorld<M extends WorldMethod>(
  cdp: PageConnection,
  method: M,
  params: CommandParams<M>,
  withContext: (contextId: number) => CommandParams<M>,
  inMainWorld: () => Promise<CommandReturn<M>> = () => sendTyped(cdp, method, params)
): Promise<CommandReturn<M>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const contextId = await worldContext(cdp);
    if (contextId === null) break;
    try {
      return await sendTyped(cdp, method, withContext(contextId));
    } catch (error) {
      if (!CONTEXT_GONE.test(getErrorMessage(error))) throw error;
      worlds.delete(cdp);
    }
  }
  return inMainWorld();
}

/**
 * `Runtime.evaluate` in bdg's world of the top frame. A call that names its
 * own context is sent as it is.
 *
 * @param cdp - Connection to the page
 * @param params - Evaluate parameters
 * @returns Evaluate response
 */
export async function evaluateInBdgWorld(
  cdp: PageConnection,
  params: Protocol.Runtime.EvaluateRequest
): Promise<Protocol.Runtime.EvaluateResponse> {
  if (params.contextId !== undefined || params.uniqueContextId !== undefined) {
    return sendTyped(cdp, 'Runtime.evaluate', { ...params });
  }
  return sendInWorld(cdp, 'Runtime.evaluate', { ...params }, (contextId) => ({
    ...params,
    contextId,
  }));
}

/**
 * A `Runtime.callFunctionOn` of a page function on no object: the function
 * gets its parameters as the call's `arguments`, never in its source.
 */
export type PageFunctionCall = Omit<
  Protocol.Runtime.CallFunctionOnRequest,
  'objectId' | 'executionContextId' | 'uniqueContextId'
>;

/**
 * Call a page function in bdg's world of the top frame, or in the main world
 * when there is none ({@link callFunctionInMainWorld}).
 *
 * @param cdp - Connection to the page
 * @param params - The function, its arguments and the call's options
 * @returns Call response
 */
export async function callFunctionInBdgWorld(
  cdp: PageConnection,
  params: PageFunctionCall
): Promise<Protocol.Runtime.CallFunctionOnResponse> {
  return sendInWorld(
    cdp,
    'Runtime.callFunctionOn',
    { ...params },
    (executionContextId) => ({ ...params, executionContextId }),
    () => callFunctionInMainWorld(cdp, params)
  );
}

/** Chrome's error for a call on an object whose document went away meanwhile */
const OBJECT_GONE = /Could not find object with given id/;

/**
 * An object of the main world of the top frame to call page functions on:
 * the page's global object, as `this` of a top-level script, which no page
 * property can change (`globalThis` is a writable property a page can set
 * to anything). When that yields no object, the document resolved into the
 * main world stands in.
 *
 * @param cdp - Connection to the page
 * @param objectGroup - Object group for the handle, if any
 * @returns Remote object id
 */
async function mainWorldObject(
  cdp: PageConnection,
  objectGroup: string | undefined
): Promise<string | undefined> {
  const group = objectGroup !== undefined && { objectGroup };
  const global = await sendTyped(cdp, 'Runtime.evaluate', {
    expression: 'this',
    ...group,
  });
  if (global.result.objectId) return global.result.objectId;
  const { root } = await sendTyped(cdp, 'DOM.getDocument', {
    depth: 0,
  });
  const resolved = await sendTyped(cdp, 'DOM.resolveNode', {
    nodeId: root.nodeId,
    ...group,
  });
  return resolved.object.objectId;
}

/**
 * Call a page function in the main world of the top frame, on the page's
 * global object ({@link mainWorldObject}; CDP needs an object or a context
 * to call on). A page that navigated between the lookup and the call fails
 * it as a lost context, like a `Runtime.evaluate` of the old document.
 * Without an object group, the object is released afterwards without
 * waiting: a function that started a navigation (a form submit) has the page
 * hold every command until the new document commits.
 *
 * @param cdp - Connection to the page
 * @param params - The function, its arguments and the call's options
 * @returns Call response
 */
export async function callFunctionInMainWorld(
  cdp: PageConnection,
  params: PageFunctionCall
): Promise<Protocol.Runtime.CallFunctionOnResponse> {
  const { objectGroup } = params;
  const objectId = await mainWorldObject(cdp, objectGroup);
  try {
    return await sendTyped(cdp, 'Runtime.callFunctionOn', {
      ...params,
      ...(objectId !== undefined && { objectId }),
    });
  } catch (error) {
    if (error instanceof CDPProtocolError && OBJECT_GONE.test(error.message)) {
      throw new CDPProtocolError(
        'Execution context was destroyed: the page navigated during the call',
        error.code,
        error.data
      );
    }
    throw error;
  } finally {
    if (objectGroup === undefined && objectId) {
      void cdp.send('Runtime.releaseObject', { objectId }).catch((error: unknown) => {
        log.debug(`Global object not released: ${getErrorMessage(error)}`);
      });
    }
  }
}

/**
 * `DOM.resolveNode` into bdg's world of the top frame, so functions called on
 * the node run there. A node the world cannot use (one of a cross-origin
 * frame, or one no longer in the page) is resolved in its own frame's main
 * world, as before.
 *
 * @param cdp - Connection to the page
 * @param params - Resolve parameters
 * @returns Resolve response
 */
export async function resolveNodeInBdgWorld(
  cdp: PageConnection,
  params: Protocol.DOM.ResolveNodeRequest
): Promise<Protocol.DOM.ResolveNodeResponse> {
  if (params.executionContextId !== undefined) {
    return sendTyped(cdp, 'DOM.resolveNode', { ...params });
  }
  try {
    const resolved = await sendInWorld(
      cdp,
      'DOM.resolveNode',
      { ...params },
      (executionContextId) => ({ ...params, executionContextId })
    );
    if (await usableInWorld(cdp, resolved.object.objectId)) return resolved;
  } catch (error) {
    log.debug(`Node resolved in the page's world: ${getErrorMessage(error)}`);
  }
  return sendTyped(cdp, 'DOM.resolveNode', { ...params });
}

/**
 * Whether a node resolved into bdg's world can be used there: a node of a
 * cross-origin frame resolves, but every access to it throws.
 *
 * @param cdp - Connection to the page
 * @param objectId - The node in bdg's world
 * @returns True when it can be read
 */
async function usableInWorld(cdp: PageConnection, objectId: string | undefined): Promise<boolean> {
  if (!objectId) return false;
  const probe = await sendTyped(cdp, 'Runtime.callFunctionOn', {
    objectId,
    functionDeclaration:
      'function () { try { return this.isConnected === true; } catch (e) { return false; } }',
    returnByValue: true,
  });
  return probe.result.value === true;
}

/**
 * Send a CDP command for bdg's own scripts: `Runtime.evaluate`,
 * `DOM.resolveNode` and a `Runtime.callFunctionOn` on no object or context
 * go to bdg's world, other methods as they are.
 *
 * @param cdp - Connection to the page
 * @param method - CDP method
 * @param params - Its parameters
 * @returns The command's result
 */
export function sendForBdgScript(
  cdp: PageConnection,
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  if (method === 'Runtime.evaluate') {
    return evaluateInBdgWorld(cdp, params as unknown as Protocol.Runtime.EvaluateRequest);
  }
  if (method === 'DOM.resolveNode') {
    return resolveNodeInBdgWorld(cdp, params);
  }
  if (
    method === 'Runtime.callFunctionOn' &&
    !('objectId' in params || 'executionContextId' in params || 'uniqueContextId' in params)
  ) {
    return callFunctionInBdgWorld(cdp, params as unknown as PageFunctionCall);
  }
  return cdp.send(method, params);
}
