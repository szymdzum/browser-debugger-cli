/**
 * Event listeners that run for an element (`bdg dom listeners`).
 *
 * Collects the listeners of the element, every ancestor (through open shadow
 * roots), its document and its window with `DOMDebugger.getEventListeners`,
 * so handlers that frameworks attach by delegation (React on its root
 * container, jQuery on `document`) are found too, along with the handlers
 * behind them (jQuery's handlers, React's `on…` props). The Debugger domain is not
 * enabled: that would make `debugger;` statements pause the page.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPProtocolError } from '@/connection/errors.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { eventListenersUnavailableError, operationFailedError } from '@/errors/messages.js';
import type { DomListenersCommand } from '@/ipc/protocol/commands.js';
import type { ListenersResult } from '@/ipc/protocol/domTypes.js';
import {
  throwIfInvalidSelector,
  withMultipleMatchesWarning,
} from '@/runtime/dom/formFillHelpers/shared.js';
import { ELEMENT_INFO_JS, type ElementInfo } from '@/runtime/dom/listenerPageScripts.js';
import {
  buildListenerReport,
  describeChainEntry,
  suggestEventTypes,
  type ChainEntry,
  type ChainListeners,
  type HandlerDetails,
  type ListenerReport,
  type ReactPropHandler,
  type ResolvedHandler,
} from '@/runtime/dom/listenerSummary.js';
import { DEEP_QUERY_JS, missingElementError, selectorArgsJS } from '@/runtime/dom/targetNode.js';
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

/** What the page tells about the element and its listeners */
interface PageDetails {
  /** Per flattened listener: handler name, jQuery handlers */
  details: HandlerDetails[];
  /** Framework label per chain entry */
  roots: Array<string | null>;
  /** Iframe element holding the element's document */
  frame?: string;
  /** jQuery handlers left unresolved (over the limit) */
  jquerySkipped?: number;
  /** React `on…` props of the element and its ancestors */
  react: ReactPropHandler[];
  /** React props left unresolved (over the limit) */
  reactSkipped?: number;
}

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
    const collected = await collectListeners(cdp, chain);
    const page = await pageDetails(cdp, chain, collected, objectGroup);
    const found = collected.map((item) => {
      const framework = page.roots[item.position];
      return framework ? { ...item, entry: { ...item.entry, framework } } : item;
    });
    const report = buildListenerReport(found, page.details, params, page.react);
    const result: ListenersResult = {
      success: true,
      selector: params.selector,
      ...(params.index !== undefined && { index: params.index }),
      element: describeChainEntry(chain[0] ?? {}),
      ...(page.frame && { frame: page.frame }),
      listeners: report.listeners,
      ...(report.collapsed.length > 0 && { collapsed: report.collapsed }),
      ...typeSuggestions(found, report, params.types),
      ...(page.jquerySkipped && { jqueryHandlersSkipped: page.jquerySkipped }),
      ...(page.reactSkipped && { reactHandlersSkipped: page.reactSkipped }),
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
 * `--type` values the user probably meant, when none matched.
 *
 * @param found - All listeners found
 * @param report - The filtered report
 * @param types - Requested types
 * @returns `{ typeSuggestions }` when there are any
 */
function typeSuggestions(
  found: ChainListeners[],
  report: ListenerReport,
  types: string[] | undefined
): Pick<ListenersResult, 'typeSuggestions'> {
  if (!types?.length || report.listeners.length > 0 || report.collapsed.length > 0) return {};
  const available = [...new Set(found.flatMap((entry) => entry.listeners.map((l) => l.type)))];
  const suggestions = suggestEventTypes(types, available);
  return suggestions.length > 0 ? { typeSuggestions: suggestions } : {};
}

/**
 * Ask the page about the element and its listeners' handlers: their names
 * (`Function.name` also knows names of arrow functions assigned to
 * variables, and `bound f` for bound functions), which function object each
 * calls, the jQuery handlers behind jQuery's dispatcher, React's `on…`
 * props of the element and its ancestors, React root containers and the
 * element's iframe.
 *
 * @param cdp - CDP connection
 * @param chain - Event targets, element first
 * @param found - Listeners per chain entry
 * @param objectGroup - Object group for the handles
 * @returns Details; empty when the page could not tell
 */
async function pageDetails(
  cdp: CDPConnection,
  chain: ChainObject[],
  found: ChainListeners[],
  objectGroup: string
): Promise<PageDetails> {
  const listeners = found.flatMap((entry) =>
    entry.listeners.map((listener) => ({ position: entry.position, listener }))
  );
  const handlers = listeners.map(({ listener }) => listener.handler);
  try {
    const targets = await Promise.all(handlers.map((handler) => boundTarget(cdp, handler)));
    const response = (await cdp.send('Runtime.callFunctionOn', {
      objectId: chain[0]?.objectId,
      functionDeclaration: ELEMENT_INFO_JS,
      arguments: [
        { value: listeners.map(({ position, listener }) => ({ position, type: listener.type })) },
        ...chain.map((entry) => ({ objectId: entry.objectId })),
        ...handlers.map(objectArgument),
        ...targets.map(objectArgument),
      ],
      objectGroup,
    })) as Protocol.Runtime.CallFunctionOnResponse;
    const [infoObject, ...fns] = await arrayItems(cdp, response.result.objectId ?? '');
    const info = await valueOf<ElementInfo>(cdp, infoObject?.objectId ?? '');
    return toPageDetails(info, await Promise.all(fns.map((fn) => handlerSource(cdp, fn))));
  } catch (error) {
    log.debug(`Handler details not read: ${getErrorMessage(error)}`);
    return { details: [], roots: [], react: [] };
  }
}

/**
 * A `Runtime.callFunctionOn` argument for a remote object.
 *
 * @param object - The object, if any
 * @returns Its handle, or null
 */
function objectArgument(
  object: Protocol.Runtime.RemoteObject | undefined
): Protocol.Runtime.CallArgument {
  return object?.objectId ? { objectId: object.objectId } : { value: null };
}

/**
 * An internal property (`[[TargetFunction]]`, `[[FunctionLocation]]`) of a
 * page object.
 *
 * @param cdp - CDP connection
 * @param objectId - The object
 * @param name - Property name
 * @returns Its value, undefined when missing or unreadable
 */
async function internalProperty(
  cdp: CDPConnection,
  objectId: string,
  name: string
): Promise<Protocol.Runtime.RemoteObject | undefined> {
  try {
    const { internalProperties = [] } = (await cdp.send('Runtime.getProperties', {
      objectId,
      ownProperties: true,
    })) as Protocol.Runtime.GetPropertiesResponse;
    return internalProperties.find((property) => property.name === name)?.value;
  } catch (error) {
    log.debug(`${name} not read: ${getErrorMessage(error)}`);
    return undefined;
  }
}

/**
 * The function a bound handler calls (React binds one dispatcher per event
 * type), so dispatchers are recognised by function identity.
 *
 * @param cdp - CDP connection
 * @param handler - Listener handler
 * @returns The target function, undefined for handlers that are not bound
 */
async function boundTarget(
  cdp: CDPConnection,
  handler: Protocol.Runtime.RemoteObject | undefined
): Promise<Protocol.Runtime.RemoteObject | undefined> {
  if (!handler?.objectId || !handler.description?.includes('[native code]')) return undefined;
  return internalProperty(cdp, handler.objectId, '[[TargetFunction]]');
}

/**
 * Copy a page object by value.
 *
 * @param cdp - CDP connection
 * @param objectId - The object
 * @returns Its JSON value
 */
async function valueOf<T>(cdp: CDPConnection, objectId: string): Promise<T> {
  const response = (await cdp.send('Runtime.callFunctionOn', {
    objectId,
    functionDeclaration: 'function () { return this; }',
    returnByValue: true,
  })) as Protocol.Runtime.CallFunctionOnResponse;
  return response.result.value as T;
}

/** Source and location of a handler function */
type HandlerSource = Pick<ResolvedHandler, 'source' | 'scriptId' | 'lineNumber' | 'columnNumber'>;

/**
 * Source and location of a framework handler function (no location when
 * it cannot be read).
 *
 * @param cdp - CDP connection
 * @param fn - The function
 * @returns Its source and location
 */
async function handlerSource(
  cdp: CDPConnection,
  fn: Protocol.Runtime.RemoteObject | undefined
): Promise<HandlerSource> {
  const source = { source: fn?.description, scriptId: '0', lineNumber: 0, columnNumber: 0 };
  if (!fn?.objectId) return source;
  const location = (await internalProperty(cdp, fn.objectId, '[[FunctionLocation]]'))?.value as
    Partial<Protocol.Debugger.Location> | undefined;
  return { ...source, ...location };
}

/** Location of a handler whose source could not be read */
const UNKNOWN_SOURCE: HandlerSource = { scriptId: '0', lineNumber: 0, columnNumber: 0 };

/**
 * Combine the page's report with the framework handlers' sources.
 *
 * @param info - Page report
 * @param sources - Source and location of each jQuery handler, then each
 *   React prop handler, in report order
 * @returns Details per listener and the React prop handlers
 */
function toPageDetails(info: ElementInfo, sources: HandlerSource[]): PageDetails {
  let next = 0;
  const details = info.listeners.map(({ name, identity, targetName, jquery }) => ({
    name: name ?? undefined,
    identity: identity ?? undefined,
    targetName: targetName ?? undefined,
    jquery: jquery?.map((handler) => ({
      type: handler.type,
      selector: handler.selector ?? undefined,
      name: handler.name,
      ...(sources[next++] ?? UNKNOWN_SOURCE),
    })),
  }));
  const react = info.react.map((handler) => ({
    ...handler,
    ...(sources[next++] ?? UNKNOWN_SOURCE),
  }));
  return {
    details,
    roots: info.roots,
    react,
    ...(info.frame && { frame: info.frame }),
    ...(info.jquerySkipped > 0 && { jquerySkipped: info.jquerySkipped }),
    ...(info.reactSkipped > 0 && { reactSkipped: info.reactSkipped }),
  };
}
