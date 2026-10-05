/**
 * CDP-relay helpers for DOM query and read operations.
 *
 * Covers `bdg dom query` (find by selector) and `bdg dom get` (read details)
 * plus selector resolution and single-node DOM context lookups.
 *
 * Node ids reported to users and stored in the query cache are backend node
 * ids: they identify an element for as long as it stays in the page, across
 * bdg invocations. Selectors are matched in the page, including open shadow
 * roots and same-origin iframes, like a user sees the page.
 */

import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  noNodesFoundError,
  indexOutOfRangeError,
  eitherArgumentRequiredError,
  invalidSelectorError,
  nodeIdNotFoundError,
  operationFailedError,
  staleNodeError,
  type ErrorWithSuggestion,
} from '@/errors/messages.js';
import { callCDP } from '@/ipc/client.js';
import type { LayoutSize } from '@/ipc/protocol/domTypes.js';
import {
  ELEMENT_GEOMETRY_JS,
  VIEWPORT_SIZE_JS,
  classifyViewportPosition,
  type ElementGeometry,
} from '@/runtime/dom/elementGeometry.js';
import { ELEMENT_CONTEXT_JS, ELEMENT_TEXT_JS, textPreview } from '@/runtime/dom/elementInfo.js';
import { DEEP_QUERY_JS, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { resolveA11yNode } from '@/telemetry/a11y.js';
import type {
  A11yNode,
  DomQueryResult,
  DomGetResult,
  DomGetOptions,
  DomContext,
  NodeRef,
  ViewportPosition,
} from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import { parseSelectorFilters, withoutVisibleFilters } from '@/utils/selectorFilters.js';

const log = createLogger('dom');

/** Maximum concurrent CDP calls to avoid overwhelming the connection. */
const CDP_CONCURRENCY_LIMIT = 10;

/**
 * Convert CDP's flat attribute list to a record.
 *
 * @param attributes - `[name, value, name, value, ...]`
 * @returns Attribute map
 */
function unpackAttributes(attributes: string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!attributes) return result;
  for (let i = 0; i < attributes.length; i += 2) {
    const key = attributes[i];
    const value = attributes[i + 1];
    if (key !== undefined && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Describe a node.
 *
 * @param ref - Node reference
 * @returns Node description, or null if the node does not exist
 */
async function describeNode(ref: NodeRef): Promise<Protocol.DOM.Node | null> {
  const response = await callCDP('DOM.describeNode', ref);
  if (response.status === 'error') return null;
  return (response.data?.result as Protocol.DOM.DescribeNodeResponse | undefined)?.node ?? null;
}

/**
 * Get a node's outer HTML.
 *
 * @param ref - Node reference
 * @returns Outer HTML, or undefined if unavailable
 */
async function getOuterHTML(ref: NodeRef): Promise<string | undefined> {
  const response = await callCDP('DOM.getOuterHTML', ref);
  return (response.data?.result as Protocol.DOM.GetOuterHTMLResponse | undefined)?.outerHTML;
}

/** Counter giving each query its own object group (queries may run concurrently) */
let queryCount = 0;

/**
 * Find the elements matching a selector, including those in open shadow roots
 * and same-origin iframes ({@link DEEP_QUERY_JS}).
 *
 * @param selector - CSS selector
 * @returns Backend node ids of all matches
 * @throws CommandError (81) for an invalid selector
 */
async function selectAll(selector: string): Promise<number[]> {
  const ids = await withSelection(selector, elementBackendNodeIds);
  return ids.filter((id): id is number => id !== undefined);
}

/**
 * Run the selector in the page and use the array of matches.
 *
 * @param selector - CSS selector
 * @param use - Reads what it needs from the page-side array
 * @returns What `use` returns
 * @throws CommandError (81) for an invalid selector
 */
async function withSelection<T>(
  selector: string,
  use: (arrayObjectId: string) => Promise<T>
): Promise<T> {
  await callCDP('DOM.enable', {});
  const objectGroup = `bdg-query-${process.pid}-${++queryCount}`;
  const evaluated = await callCDP('Runtime.evaluate', {
    expression: `(${DEEP_QUERY_JS})(${selectorArgsJS(selector)})`,
    objectGroup,
  });
  try {
    return await use(selectionObjectId(selector, evaluated));
  } finally {
    await callCDP('Runtime.releaseObjectGroup', { objectGroup });
  }
}

/**
 * The "no nodes" error for a selector that matched nothing. One more page
 * evaluation, on this failure path only, tells whether the page is still
 * loading (the error then suggests `dom wait`) and, when the selector uses
 * `:visible`, how many elements match without it.
 *
 * @param selector - Selector as given
 * @returns Message and suggestion
 */
export async function noMatchesError(selector: string): Promise<ErrorWithSuggestion> {
  const { hidden, readyState } = await noMatchContext(selector);
  return noNodesFoundError(selector, hidden, readyState);
}

/**
 * The page's readyState and the number of elements the selector matches
 * with its `:visible` filters removed, in one evaluation.
 *
 * @param selector - Selector as given
 * @returns Hidden matches (0 without a `:visible` filter) and readyState (undefined when the page did not answer)
 */
async function noMatchContext(selector: string): Promise<{ hidden: number; readyState?: string }> {
  const parts = parseSelectorFilters(selector);
  const unfiltered = parts && withoutVisibleFilters(parts);
  const hidden = unfiltered
    ? `(() => { try { return (${DEEP_QUERY_JS})(${JSON.stringify(selector)}, ${JSON.stringify(unfiltered)}).length; } catch (e) { return 0; } })()`
    : '0';
  try {
    const evaluated = await callCDP('Runtime.evaluate', {
      expression: `({ hidden: ${hidden}, readyState: document.readyState })`,
      returnByValue: true,
    });
    const { result } = (evaluated.data?.result ?? {}) as Partial<Protocol.Runtime.EvaluateResponse>;
    const value = (result?.value ?? {}) as { hidden?: unknown; readyState?: unknown };
    return {
      hidden: typeof value.hidden === 'number' ? value.hidden : 0,
      ...(typeof value.readyState === 'string' && { readyState: value.readyState }),
    };
  } catch (error) {
    log.debug(`Could not read the page after no match: ${getErrorMessage(error)}`);
    return { hidden: 0 };
  }
}

/**
 * The page's `document.readyState`, read for a failure that may come from a
 * page still loading.
 *
 * @returns The state, or undefined when the page did not answer
 */
export async function documentReadyState(): Promise<string | undefined> {
  try {
    const evaluated = await callCDP('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true,
    });
    const { result } = (evaluated.data?.result ?? {}) as Partial<Protocol.Runtime.EvaluateResponse>;
    return typeof result?.value === 'string' ? result.value : undefined;
  } catch (error) {
    log.debug(`Could not read document.readyState: ${getErrorMessage(error)}`);
    return undefined;
  }
}

/** Matches whose viewport position `dom query` reports (measuring is not free) */
const VIEWPORT_HINT_LIMIT = 100;

/**
 * Where each element of a page-side array lives (an iframe and/or a shadow
 * root), its text and, for the first {@link VIEWPORT_HINT_LIMIT}, its position
 * relative to the viewport, plus the viewport size. An element that cannot be
 * read gets empty details instead of failing the whole query.
 */
const ELEMENT_DETAILS_FUNCTION = `function () {
  const contextOf = ${ELEMENT_CONTEXT_JS};
  const textOf = ${ELEMENT_TEXT_JS};
  const geometryOf = ${ELEMENT_GEOMETRY_JS};
  const read = (el, index) => {
    try {
      return { context: contextOf(el), text: textOf(el), geometry: index < ${VIEWPORT_HINT_LIMIT} ? geometryOf(el) : null };
    } catch (e) {
      return {};
    }
  };
  return { viewport: (${VIEWPORT_SIZE_JS})(window), elements: Array.from(this, read) };
}`;

/** One element of a selection with what `dom query` shows about it. */
interface ElementDetails {
  backendNodeId: number;
  context: string;
  text: string;
  inViewport?: ViewportPosition;
  clippedBy?: string;
}

/** What {@link ELEMENT_DETAILS_FUNCTION} returns for one element. */
interface PageElementDetails {
  context?: string;
  text?: string;
  geometry?: ElementGeometry | null;
}

/** What {@link ELEMENT_DETAILS_FUNCTION} returns. */
interface PageDetails {
  viewport?: LayoutSize;
  elements?: PageElementDetails[];
}

/**
 * Backend node ids of the elements in a page-side array, each with where it
 * lives (empty for the main document), its text and its viewport position.
 *
 * @param arrayObjectId - Remote object id of the array
 * @returns Elements in array order (ones that cannot be described are left out)
 * @throws CommandError (91) when the page could not describe the matches
 */
async function elementsWithDetails(arrayObjectId: string): Promise<ElementDetails[]> {
  const { viewport, elements = [] } = await readPageDetails(arrayObjectId);
  const ids = await elementBackendNodeIds(arrayObjectId);
  return ids.flatMap((backendNodeId, index) => {
    if (backendNodeId === undefined) return [];
    const details = elements[index];
    return [
      {
        backendNodeId,
        context: details?.context ?? '',
        text: details?.text ?? '',
        ...viewportHint(details?.geometry, viewport),
      },
    ];
  });
}

/**
 * Run {@link ELEMENT_DETAILS_FUNCTION} on a page-side array.
 *
 * @param arrayObjectId - Remote object id of the array
 * @returns Details of each element and the viewport size
 * @throws CommandError (91) when the script failed
 */
async function readPageDetails(arrayObjectId: string): Promise<PageDetails> {
  const response = await callCDP('Runtime.callFunctionOn', {
    objectId: arrayObjectId,
    functionDeclaration: ELEMENT_DETAILS_FUNCTION,
    returnByValue: true,
  });
  const result = response.data?.result as
    Partial<Protocol.Runtime.CallFunctionOnResponse> | undefined;
  if (response.status === 'error' || result?.exceptionDetails) {
    const detail =
      result?.exceptionDetails?.exception?.description ?? response.error ?? 'no result';
    const err = operationFailedError('describe the matches', detail.split('\n')[0] ?? detail);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SCRIPT_ERROR);
  }
  return (result?.result?.value ?? {}) as PageDetails;
}

/**
 * Viewport position of a measured element for `dom query`.
 *
 * @param geometry - Page-side measurements (none beyond the hint limit)
 * @param viewport - Viewport size
 * @returns `inViewport` (and `clippedBy`), or nothing when not measured
 */
function viewportHint(
  geometry: ElementGeometry | null | undefined,
  viewport: LayoutSize | undefined
): Pick<ElementDetails, 'inViewport' | 'clippedBy'> {
  if (!geometry || !viewport) return {};
  const { inViewport, clippedBy } = classifyViewportPosition(geometry, viewport);
  return { inViewport, ...(clippedBy && { clippedBy }) };
}

/**
 * The page-side array of a selector query, or the error explaining why there
 * is none: a selector the browser rejects (a `SyntaxError` DOMException) is the
 * user's (81; the browser's message is left out for selectors with filters,
 * as it quotes the CSS bdg rewrote them to); anything else (no session, a
 * page navigating away) is not.
 *
 * @param selector - CSS selector
 * @param evaluated - `Runtime.evaluate` response
 * @returns Remote object id of the array of matches
 * @throws CommandError (81) for an invalid selector, (101) otherwise
 */
function selectionObjectId(
  selector: string,
  evaluated: Awaited<ReturnType<typeof callCDP>>
): string {
  const { result, exceptionDetails } = (evaluated.data?.result ??
    {}) as Partial<Protocol.Runtime.EvaluateResponse>;
  const description = exceptionDetails?.exception?.description;
  if (description?.startsWith('SyntaxError')) {
    const detail = parseSelectorFilters(selector) ? undefined : description.split('\n')[0];
    const err = invalidSelectorError(selector, detail);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  if (evaluated.status === 'error' || exceptionDetails || !result?.objectId) {
    const detail = exceptionDetails?.exception?.description ?? evaluated.error ?? 'no result';
    throw new CommandError(
      `Could not search the page for "${selector}": ${detail.split('\n')[0]}`,
      { suggestion: 'Check that the page has finished loading, then retry' },
      EXIT_CODES.CDP_CONNECTION_FAILURE
    );
  }
  return result.objectId;
}

/**
 * Backend node ids of the elements in a page-side array.
 *
 * @param arrayObjectId - Remote object id of the array
 * @returns Backend node ids in array order (`undefined` where an element
 *   cannot be described, so positions match the array)
 */
async function elementBackendNodeIds(arrayObjectId: string): Promise<Array<number | undefined>> {
  const response = await callCDP('Runtime.getProperties', {
    objectId: arrayObjectId,
    ownProperties: true,
  });
  const properties =
    (response.data?.result as Protocol.Runtime.GetPropertiesResponse | undefined)?.result ?? [];
  const elementIds = properties
    .filter((property) => /^\d+$/.test(property.name))
    .sort((a, b) => Number(a.name) - Number(b.name))
    .map((property) => property.value?.objectId);
  const ids = await mapConcurrently(elementIds, async (objectId) => {
    if (!objectId) return undefined;
    const described = await callCDP('DOM.describeNode', { objectId });
    return (described.data?.result as Protocol.DOM.DescribeNodeResponse | undefined)?.node
      .backendNodeId;
  });
  return ids;
}

/**
 * Run an async mapper over items with bounded CDP concurrency.
 *
 * @param items - Items to map
 * @param mapper - Async mapper
 * @returns Mapped results in input order
 */
function mapConcurrently<T, R>(
  items: T[],
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const limiter = new ConcurrencyLimiter(CDP_CONCURRENCY_LIMIT);
  return Promise.all(items.map((item, index) => limiter.run(() => mapper(item, index))));
}

/**
 * Query elements by selector for `bdg dom query`.
 *
 * @param selector - CSS selector
 * @returns Matches with backend node ids, tags, classes and text previews
 */
export async function queryDOMElements(selector: string): Promise<DomQueryResult> {
  const elements = await withSelection(selector, elementsWithDetails);
  if (elements.length > 20) {
    log.debug(`Querying ${elements.length} elements with selector: ${selector}`);
  }

  const nodes = await mapConcurrently(elements, async (element, index) => {
    const { backendNodeId, context, text, inViewport, clippedBy } = element;
    const desc = await describeNode({ backendNodeId });
    if (!desc) return { index, nodeId: 0 };
    const attributes = unpackAttributes(desc.attributes);
    const classes = attributes['class']?.split(/\s+/).filter(Boolean);
    const preview = textPreview(text);
    return {
      index,
      nodeId: desc.backendNodeId,
      tag: desc.nodeName.toLowerCase(),
      ...identifyingAttributes(attributes),
      ...(classes && { classes }),
      ...(preview && { preview }),
      ...(context && { context }),
      ...(inViewport && { inViewport }),
      ...(clippedBy && { clippedBy }),
    };
  });

  return { selector, count: nodes.length, nodes };
}

/**
 * The attributes that tell similar elements apart (form fields especially).
 *
 * @param attributes - Element attributes
 * @returns id, name and type when present
 */
function identifyingAttributes(
  attributes: Record<string, string>
): Pick<DomQueryResult['nodes'][number], 'id' | 'name' | 'type'> {
  return {
    ...(attributes['id'] && { id: attributes['id'] }),
    ...(attributes['name'] && { name: attributes['name'] }),
    ...(attributes['type'] && { type: attributes['type'] }),
  };
}

/**
 * The text of one element as the page renders it ({@link ELEMENT_TEXT_JS}).
 *
 * @param ref - Node reference
 * @returns Element text, or empty when the node cannot be read
 */
async function elementText(ref: NodeRef): Promise<string> {
  const objectGroup = `bdg-text-${process.pid}-${++queryCount}`;
  const resolved = await callCDP('DOM.resolveNode', { ...ref, objectGroup });
  const objectId = (resolved.data?.result as Protocol.DOM.ResolveNodeResponse | undefined)?.object
    .objectId;
  if (!objectId) return '';
  try {
    const response = await callCDP('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function () { return (${ELEMENT_TEXT_JS})(this); }`,
      returnByValue: true,
    });
    const value = (response.data?.result as { result?: { value?: unknown } } | undefined)?.result
      ?.value;
    return typeof value === 'string' ? value : '';
  } finally {
    await callCDP('Runtime.releaseObjectGroup', { objectGroup });
  }
}

/**
 * Get DOM context (tag, classes, text preview) for a node.
 *
 * @param ref - Node reference
 * @returns DOM context, or null if the node does not exist
 */
export async function getDomContext(ref: NodeRef): Promise<DomContext | null> {
  await callCDP('DOM.enable', {});
  const desc = await describeNode(ref);
  if (!desc) {
    log.debug(`No DOM context for ${JSON.stringify(ref)}`);
    return null;
  }
  const classes = unpackAttributes(desc.attributes)['class']?.split(/\s+/).filter(Boolean);
  const preview = textPreview(await elementText(ref));
  return {
    tag: desc.nodeName.toLowerCase(),
    ...(classes && classes.length > 0 && { classes }),
    ...(preview && { preview }),
  };
}

/**
 * Pick the nodes `dom get --raw` should report for a selector.
 *
 * @param selector - CSS selector
 * @param options - `nth` / `all` options
 * @returns Node references to describe
 */
async function selectForGet(selector: string, options: DomGetOptions): Promise<NodeRef[]> {
  const backendNodeIds = await selectAll(selector);
  if (backendNodeIds.length === 0) {
    const err = await noMatchesError(selector);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  if (options.all) return backendNodeIds.map((backendNodeId) => ({ backendNodeId }));

  const position = options.nth ?? 0;
  const backendNodeId = backendNodeIds[position];
  if (backendNodeId === undefined) {
    const err = indexOutOfRangeError(position, backendNodeIds.length - 1);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }
  return [{ backendNodeId }];
}

/**
 * Get full details (attributes, outer HTML) for `bdg dom get --raw`.
 *
 * @param options - Selector (with nth/all) or a backend node id
 * @returns Node details; `nodeId` is the backend node id
 * @throws CommandError (83) when a node id does not exist
 */
export async function getDOMElements(options: DomGetOptions): Promise<DomGetResult> {
  let refs: NodeRef[];
  if (options.nodeId !== undefined) {
    await callCDP('DOM.enable', {});
    await assertNodeAttached(options.nodeId).catch(() => {
      const err = nodeIdNotFoundError(options.nodeId ?? 0);
      throw new CommandError(
        err.message,
        { suggestion: err.suggestion },
        EXIT_CODES.RESOURCE_NOT_FOUND
      );
    });
    refs = [{ backendNodeId: options.nodeId }];
  } else if (options.selector) {
    refs = await selectForGet(options.selector, options);
  } else {
    const err = eitherArgumentRequiredError(
      'selector',
      'nodeId',
      `${sessionCommand('bdg dom get <selector>')} or ${sessionCommand('bdg dom get --node-id <id>')}`
    );
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }

  const nodes = await mapConcurrently(refs, async (ref) => {
    const desc = await describeNode(ref);
    if (!desc) {
      const err = nodeIdNotFoundError(options.nodeId ?? 0);
      throw new CommandError(
        err.message,
        { suggestion: err.suggestion },
        EXIT_CODES.RESOURCE_NOT_FOUND
      );
    }
    const attributes = unpackAttributes(desc.attributes);
    const classes = attributes['class']?.split(/\s+/).filter(Boolean);
    const outerHTML = await getOuterHTML(ref);
    return {
      nodeId: desc.backendNodeId,
      tag: desc.nodeName.toLowerCase(),
      ...(Object.keys(attributes).length > 0 && { attributes }),
      ...(classes && { classes }),
      ...(outerHTML && { outerHTML }),
    };
  });

  return { nodes };
}

/**
 * Resolve a selector to its first match.
 *
 * @param selector - CSS selector
 * @returns Reference to the first matching node (valid within this command)
 * @throws CommandError (83) when nothing matches
 */
export async function resolveSelector(selector: string): Promise<NodeRef> {
  const backendNodeId = (await selectAll(selector))[0];
  if (backendNodeId === undefined) {
    const err = await noMatchesError(selector);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  return { backendNodeId };
}

/**
 * Resolve selectors to backend node ids (first match each).
 *
 * @param selectors - CSS selectors
 * @returns Backend node id per selector, or undefined when it matches nothing
 */
export async function resolveBackendNodeIds(selectors: string[]): Promise<(number | undefined)[]> {
  return mapConcurrently(selectors, async (selector) => (await selectAll(selector))[0]);
}

/**
 * Accessibility node of the first element matching a selector.
 *
 * @param selector - CSS selector
 * @returns A11y node, or null when nothing matches or the node is not exposed
 */
export async function resolveA11yNodeForSelector(selector: string): Promise<A11yNode | null> {
  const [backendNodeId] = await resolveBackendNodeIds([selector]);
  return backendNodeId === undefined ? null : resolveA11yNode({ backendNodeId });
}

/**
 * Check that a cached element is still part of the current page.
 *
 * `DOM.describeNode` still answers for nodes of a previous document, so
 * existence is checked by resolving the node into the page's JavaScript
 * context, which fails for other documents, and by `isConnected`, which is
 * false for removed elements.
 *
 * @param backendNodeId - Backend node id from the query cache
 * @param index - Index the user gave, for the error message
 * @throws CommandError (87) when the element is gone
 */
export async function assertNodeAttached(backendNodeId: number, index?: number): Promise<void> {
  const resolved = await callCDP('DOM.resolveNode', { backendNodeId, objectGroup: 'bdg-check' });
  const objectId = (resolved.data?.result as Protocol.DOM.ResolveNodeResponse | undefined)?.object
    .objectId;
  let attached = false;
  if (resolved.status !== 'error' && objectId) {
    const check = await callCDP('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function () { return this.isConnected; }',
      returnByValue: true,
    });
    attached =
      (check.data?.result as { result?: { value?: unknown } } | undefined)?.result?.value === true;
    await callCDP('Runtime.releaseObjectGroup', { objectGroup: 'bdg-check' });
  }
  if (!attached) {
    const err = staleNodeError(index);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.STALE_CACHE);
  }
}
