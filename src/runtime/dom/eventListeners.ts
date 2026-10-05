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
import { eventListenersUnavailableError, operationFailedError } from '@/errors/messages.js';
import type { DomListenersCommand } from '@/ipc/protocol/commands.js';
import type { ListenersResult } from '@/ipc/protocol/domTypes.js';
import {
  throwIfInvalidSelector,
  withMultipleMatchesWarning,
} from '@/runtime/dom/formFillHelpers/shared.js';
import {
  buildListenerReport,
  describeChainEntry,
  suggestEventTypes,
  type ChainEntry,
  type ChainListeners,
  type HandlerDetails,
  type ListenerReport,
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

/**
 * Page function, called on the element with the listeners (position in
 * the chain and event type of each), then the chain's objects, then each
 * listener's handler.
 * Returns `[info, ...jQueryHandlers]`: `info` has the iframe element holding
 * the element's document (`frame`), a framework label per chain entry
 * (`roots`: React's root container), and per listener the handler's name
 * and, for jQuery's dispatcher, the jQuery handlers that run for the element
 * (delegates only when the element matches their selector); their functions
 * follow `info` in the same order. Pages without jQuery are left alone.
 */
const ELEMENT_INFO_JS = `function (listeners, ...rest) {
  const nodes = rest.slice(0, rest.length - listeners.length);
  const handlers = rest.slice(rest.length - listeners.length);
  const view = this.ownerDocument && this.ownerDocument.defaultView;
  const describe = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
  let frame = null;
  try { frame = view && view.frameElement ? describe(view.frameElement) : null; } catch (e) { frame = null; }
  const isReactRoot = (node) => {
    try {
      return !!node && node.nodeType === 1 &&
        ('_reactRootContainer' in node || Object.keys(node).some((key) => key.startsWith('__reactContainer$')));
    } catch (e) { return false; }
  };
  const roots = nodes.map((node) => (isReactRoot(node) ? 'React root' : null));
  const jq = view ? [view.jQuery, view.$].find((c) => c && typeof c._data === 'function') : undefined;
  const matches = (el, selector) => {
    try {
      const find = jq.find;
      return find && typeof find.matchesSelector === 'function' ? find.matchesSelector(el, selector) : el.matches(selector);
    } catch (e) { return false; }
  };
  const delegatedTo = (node, selector) => {
    for (let el = this; el && el !== node; el = el.parentNode) {
      if (el.nodeType === 1 && matches(el, selector)) return true;
    }
    return false;
  };
  const jqueryHandlers = (listener, handler) => {
    if (!jq || typeof handler !== 'function') return null;
    const node = nodes[listener.position];
    let data = null;
    try { data = jq._data(node); } catch (e) { return null; }
    if (!data || data.handle !== handler || !data.events) return null;
    return (data.events[listener.type] || []).filter((h) => !h.selector || delegatedTo(node, h.selector));
  };
  const fns = [];
  const info = listeners.map((listener, i) => {
    const handler = handlers[i];
    const name = typeof handler === 'function' ? handler.name : null;
    const resolved = jqueryHandlers(listener, handler);
    if (!resolved) return { name };
    return { name, jquery: resolved.map((h) => {
      fns.push(h.handler);
      return { type: h.origType || h.type, selector: h.selector || null,
        name: typeof h.handler === 'function' ? h.handler.name : '' };
    }) };
  });
  return [{ frame, roots, listeners: info }, ...fns];
}`;

/** What {@link ELEMENT_INFO_JS} reports, by value */
interface ElementInfo {
  frame: string | null;
  roots: Array<string | null>;
  listeners: Array<{
    name: string | null;
    jquery?: Array<{ type: string; selector: string | null; name: string }>;
  }>;
}

/** What the page tells about the element and its listeners */
interface PageDetails {
  /** Per flattened listener: handler name, jQuery handlers */
  details: HandlerDetails[];
  /** Framework label per chain entry */
  roots: Array<string | null>;
  /** Iframe element holding the element's document */
  frame?: string;
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
    const report = buildListenerReport(found, page.details, params);
    const result: ListenersResult = {
      success: true,
      selector: params.selector,
      ...(params.index !== undefined && { index: params.index }),
      element: describeChainEntry(chain[0] ?? {}),
      ...(page.frame && { frame: page.frame }),
      listeners: report.listeners,
      ...(report.collapsed.length > 0 && { collapsed: report.collapsed }),
      ...typeSuggestions(found, report, params.types),
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
 * variables, and `bound f` for bound functions), the jQuery handlers behind
 * jQuery's dispatcher, React root containers and the element's iframe.
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
  try {
    const response = (await cdp.send('Runtime.callFunctionOn', {
      objectId: chain[0]?.objectId,
      functionDeclaration: ELEMENT_INFO_JS,
      arguments: [
        { value: listeners.map(({ position, listener }) => ({ position, type: listener.type })) },
        ...chain.map((entry) => ({ objectId: entry.objectId })),
        ...listeners.map(({ listener: { handler } }) =>
          handler?.objectId ? { objectId: handler.objectId } : { value: null }
        ),
      ],
      objectGroup,
    })) as Protocol.Runtime.CallFunctionOnResponse;
    const [infoObject, ...fns] = await arrayItems(cdp, response.result.objectId ?? '');
    const info = await valueOf<ElementInfo>(cdp, infoObject?.objectId ?? '');
    return toPageDetails(info, await resolvedHandlers(cdp, fns));
  } catch (error) {
    log.debug(`Handler details not read: ${getErrorMessage(error)}`);
    return { details: [], roots: [] };
  }
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
 * Source and location of framework handler functions.
 *
 * @param cdp - CDP connection
 * @param fns - The functions
 * @returns Source and location of each, in order
 */
async function resolvedHandlers(
  cdp: CDPConnection,
  fns: Array<Protocol.Runtime.RemoteObject | undefined>
): Promise<HandlerSource[]> {
  return Promise.all(
    fns.map(async (fn) => {
      const source = { source: fn?.description, scriptId: '0', lineNumber: 0, columnNumber: 0 };
      if (!fn?.objectId) return source;
      const { internalProperties = [] } = (await cdp.send('Runtime.getProperties', {
        objectId: fn.objectId,
        ownProperties: true,
      })) as Protocol.Runtime.GetPropertiesResponse;
      const location = internalProperties.find((p) => p.name === '[[FunctionLocation]]')?.value
        ?.value as Partial<Protocol.Debugger.Location> | undefined;
      return { ...source, ...location };
    })
  );
}

/**
 * Combine the page's report with the framework handlers' sources.
 *
 * @param info - Page report
 * @param sources - Source and location of each jQuery handler, in report order
 * @returns Details per listener
 */
function toPageDetails(info: ElementInfo, sources: HandlerSource[]): PageDetails {
  let next = 0;
  const details = info.listeners.map(({ name, jquery }) => ({
    name: name ?? undefined,
    jquery: jquery?.map((handler) => ({
      type: handler.type,
      selector: handler.selector ?? undefined,
      name: handler.name,
      ...(sources[next++] ?? { scriptId: '0', lineNumber: 0, columnNumber: 0 }),
    })),
  }));
  return { details, roots: info.roots, ...(info.frame && { frame: info.frame }) };
}
