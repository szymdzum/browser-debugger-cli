/**
 * Event listeners that run for an element (`bdg dom listeners`).
 *
 * Collects the listeners of the element, every ancestor (through open shadow
 * roots), its document and its window with `DOMDebugger.getEventListeners`,
 * so handlers that frameworks attach by delegation (React on its root
 * container, jQuery on `document`) are found too. The Debugger domain is not
 * enabled: that would make `debugger;` statements pause the page.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPProtocolError } from '@/connection/errors.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  eventListenersUnavailableError,
  indexOutOfRangeError,
  noNodesFoundError,
  operationFailedError,
  staleNodeError,
} from '@/errors/messages.js';
import type { DomListenersCommand } from '@/ipc/protocol/commands.js';
import type { ListenersResult } from '@/ipc/protocol/domTypes.js';
import {
  throwIfInvalidSelector,
  withMultipleMatchesWarning,
} from '@/runtime/dom/formFillHelpers/shared.js';
import {
  buildListenerReport,
  describeChainEntry,
  type ChainEntry,
  type ChainListeners,
} from '@/runtime/dom/listenerSummary.js';
import { DEEP_QUERY_JS, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/** JSON-RPC code Chrome returns for an unknown method */
const METHOD_NOT_FOUND = -32601;

/**
 * Page function: the selector's match at `index` as `[matchCount, element]`,
 * or just the match count when there is no such match.
 */
const SELECT_JS = `function (selector, parts, index) {
  const found = (${DEEP_QUERY_JS})(selector, parts);
  return found[index] ? [found.length, found[index]] : found.length;
}`;

/**
 * Page function, called on the element: `[element, ...ancestors, document,
 * window]`, or null when it left the page. Shadow roots lead to their host,
 * like composed events do.
 */
const CHAIN_JS = `function () {
  if (!this.isConnected) return null;
  const chain = [];
  const next = (node) => node.parentNode || (node.nodeType === 11 && node.host ? node.host : null);
  for (let node = this; node; node = next(node)) chain.push(node);
  const view = this.ownerDocument && this.ownerDocument.defaultView;
  if (view) chain.push(view);
  return chain;
}`;

/** Page function: names of the given functions (null for non-functions) */
const NAMES_JS = `function (...fns) {
  return fns.map((fn) => (typeof fn === 'function' ? fn.name : null));
}`;

/** Distinguishes the object groups of concurrent calls */
let groupCounter = 0;

/** An event target in the page with its CDP handle. */
interface ChainObject extends ChainEntry {
  objectId: string;
}

/**
 * List the event listeners that run for an element.
 *
 * @param cdp - CDP connection
 * @param params - Selector (and index) or backend node id, optional event types
 * @returns Listener report
 * @throws CommandError (83) no match, (81) index out of range or invalid
 *   selector, (87) the cached element left the page, (110) no DOMDebugger
 */
export async function inspectEventListeners(
  cdp: CDPConnection,
  params: DomListenersCommand
): Promise<ListenersResult> {
  const objectGroup = `bdg-listeners-${++groupCounter}`;
  try {
    const { matchCount, chain } = await findEventTargetChain(cdp, params, objectGroup);
    const found = await collectListeners(cdp, chain);
    const handlers = found.flatMap((entry) => entry.listeners.map((l) => l.handler));
    const names = await handlerNames(cdp, chain[0]?.objectId ?? '', handlers);
    const result: ListenersResult = {
      success: true,
      selector: params.selector,
      ...(params.index !== undefined && { index: params.index }),
      element: describeChainEntry(chain[0] ?? {}),
      listeners: buildListenerReport(found, names, params.types),
      ...(params.backendNodeId === undefined && { matchCount }),
    };
    return withMultipleMatchesWarning(result, params.index, 'listing the first');
  } finally {
    void cdp
      .send('Runtime.releaseObjectGroup', { objectGroup })
      .catch((error: unknown) => log.debug(`Object group not released: ${getErrorMessage(error)}`));
  }
}

/**
 * Find the element and the event targets above it.
 *
 * The chain is built in the element's own frame: `DOMDebugger.getEventListeners`
 * only reports handlers created in the context the object belongs to, so an
 * element of a same-origin iframe found from the top page would show none.
 *
 * @param cdp - CDP connection
 * @param params - Request
 * @param objectGroup - Object group for the handles
 * @returns Number of selector matches and the chain (element first, window last)
 */
async function findEventTargetChain(
  cdp: CDPConnection,
  params: DomListenersCommand,
  objectGroup: string
): Promise<{ matchCount: number; chain: ChainObject[] }> {
  const match =
    params.backendNodeId === undefined
      ? await findSelectorMatch(cdp, params, objectGroup)
      : { matchCount: 1, backendNodeId: params.backendNodeId };
  const chain = await nodeChain(cdp, match.backendNodeId, objectGroup);
  if (!chain) throw missingElementError(params, 0);
  return { matchCount: match.matchCount, chain };
}

/**
 * Find the selector's match at `--index` (searching open shadow roots and
 * same-origin frames).
 *
 * @param cdp - CDP connection
 * @param params - Request with the selector
 * @param objectGroup - Object group for the handles
 * @returns Number of matches and the backend node id of the match
 * @throws CommandError (81) invalid selector or index out of range, (83) no match
 */
async function findSelectorMatch(
  cdp: CDPConnection,
  params: DomListenersCommand,
  objectGroup: string
): Promise<{ matchCount: number; backendNodeId: number }> {
  const expression = `(${SELECT_JS})(${selectorArgsJS(params.selector)}, ${params.index ?? 0})`;
  const response = (await cdp.send('Runtime.evaluate', {
    expression,
    objectGroup,
  })) as Protocol.Runtime.EvaluateResponse;
  if (response.exceptionDetails) {
    throwIfInvalidSelector(response.exceptionDetails, params.selector);
    const err = operationFailedError('find the element', response.exceptionDetails.text);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SCRIPT_ERROR);
  }
  if (!response.result.objectId) {
    throw missingElementError(params, Number(response.result.value ?? 0));
  }
  const [count, element] = await arrayItems(cdp, response.result.objectId);
  const { node } = (await cdp.send('DOM.describeNode', {
    objectId: element?.objectId,
  })) as Protocol.DOM.DescribeNodeResponse;
  return { matchCount: Number(count?.value ?? 1), backendNodeId: node.backendNodeId };
}

/**
 * The element with `backendNodeId` and the event targets above it, resolved
 * in the element's frame.
 *
 * @param cdp - CDP connection
 * @param backendNodeId - Backend node id
 * @param objectGroup - Object group for the handles
 * @returns Chain (element first, window last), or null when the node is gone
 */
async function nodeChain(
  cdp: CDPConnection,
  backendNodeId: number,
  objectGroup: string
): Promise<ChainObject[] | null> {
  const resolved = (await cdp
    .send('DOM.resolveNode', { backendNodeId, objectGroup })
    .catch((error: unknown) => {
      log.debug(`Node ${backendNodeId} not resolved: ${getErrorMessage(error)}`);
      return {};
    })) as Partial<Protocol.DOM.ResolveNodeResponse>;
  const objectId = resolved.object?.objectId;
  if (!objectId) return null;
  const response = (await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: CHAIN_JS,
    objectGroup,
  })) as Protocol.Runtime.CallFunctionOnResponse;
  if (!response.result.objectId) return null;
  const items = await arrayItems(cdp, response.result.objectId);
  return items.flatMap((item) =>
    item?.objectId
      ? [{ objectId: item.objectId, className: item.className, description: item.description }]
      : []
  );
}

/**
 * Error for an element that could not be found.
 *
 * @param params - Request
 * @param matchCount - Elements the selector matched
 * @returns Stale (87), out of range (81) or not found (83) error
 */
function missingElementError(params: DomListenersCommand, matchCount: number): CommandError {
  if (params.backendNodeId !== undefined) {
    const err = staleNodeError();
    return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.STALE_CACHE);
  }
  if (matchCount > 0) {
    const err = indexOutOfRangeError(params.index ?? 0, matchCount - 1);
    return new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  const err = noNodesFoundError(params.selector);
  return new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.RESOURCE_NOT_FOUND
  );
}

/**
 * Items of an array in the page, in order.
 *
 * @param cdp - CDP connection
 * @param arrayId - Object id of the array
 * @returns Its items
 */
async function arrayItems(
  cdp: CDPConnection,
  arrayId: string
): Promise<Array<Protocol.Runtime.RemoteObject | undefined>> {
  const { result } = (await cdp.send('Runtime.getProperties', {
    objectId: arrayId,
    ownProperties: true,
  })) as Protocol.Runtime.GetPropertiesResponse;
  return result
    .filter((property) => /^\d+$/.test(property.name))
    .sort((a, b) => Number(a.name) - Number(b.name))
    .map((property) => property.value);
}

/**
 * Get the listeners of every event target in the chain (in parallel).
 *
 * @param cdp - CDP connection
 * @param chain - Event targets, element first
 * @returns Listeners per target
 * @throws CommandError (110) when the browser has no DOMDebugger.getEventListeners
 */
async function collectListeners(
  cdp: CDPConnection,
  chain: ChainObject[]
): Promise<ChainListeners[]> {
  try {
    return await Promise.all(
      chain.map(async (entry, position) => {
        const { listeners } = (await cdp.send('DOMDebugger.getEventListeners', {
          objectId: entry.objectId,
          depth: 0,
        })) as Protocol.DOMDebugger.GetEventListenersResponse;
        return { position, entry, listeners };
      })
    );
  } catch (error) {
    if (!(error instanceof CDPProtocolError) || error.code !== METHOD_NOT_FOUND) throw error;
    const err = eventListenersUnavailableError(error.message);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SOFTWARE_ERROR);
  }
}

/**
 * Ask the page for the handlers' names (`Function.name` also knows names of
 * arrow functions assigned to variables, and `bound f` for bound functions).
 *
 * @param cdp - CDP connection
 * @param elementId - Object id of the element (the page context to run in)
 * @param handlers - Handler objects, in report order
 * @returns Names in the same order; empty when the page could not tell
 */
async function handlerNames(
  cdp: CDPConnection,
  elementId: string,
  handlers: Array<Protocol.Runtime.RemoteObject | undefined>
): Promise<Array<string | undefined>> {
  if (handlers.length === 0) return [];
  try {
    const response = (await cdp.send('Runtime.callFunctionOn', {
      objectId: elementId,
      functionDeclaration: NAMES_JS,
      arguments: handlers.map((handler) =>
        handler?.objectId ? { objectId: handler.objectId } : { value: null }
      ),
      returnByValue: true,
    })) as Protocol.Runtime.CallFunctionOnResponse;
    const names = response.result.value as Array<string | null> | undefined;
    return (names ?? []).map((name) => name ?? undefined);
  } catch (error) {
    log.debug(`Handler names not read: ${getErrorMessage(error)}`);
    return [];
  }
}
