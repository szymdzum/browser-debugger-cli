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

import {
  closedShadowHostNames,
  CLOSED_HOST_CANDIDATES_JS,
  CLOSED_HOST_LIMIT,
} from '@/commands/dom/helpers/closedShadowHosts.js';
import { elementClasses } from '@/commands/dom/helpers/elementClasses.js';
import { keyAttributes } from '@/commands/dom/helpers/keyAttributes.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  noNodesFoundError,
  indexOutOfRangeError,
  eitherArgumentRequiredError,
  invalidSelectorError,
  nodeIdNotFoundError,
  operationFailedError,
  similarSelectorsLine,
  staleNodeError,
  type ErrorWithSuggestion,
  type NoMatchContext,
} from '@/errors/messages.js';
import { callBdgScript, callCDP } from '@/ipc/client.js';
import type { LayoutSize } from '@/ipc/protocol/domTypes.js';
import {
  ELEMENT_GEOMETRY_JS,
  VIEWPORT_SIZE_JS,
  classifyViewportPosition,
  type ElementGeometry,
} from '@/runtime/dom/elementGeometry.js';
import {
  ELEMENT_CONTEXT_JS,
  ELEMENT_STATE_JS,
  ELEMENT_TEXT_JS,
  ELEMENT_TEXT_LENGTH,
  MASKED_OUTER_HTML_JS,
  MASKED_VALUE,
  textPreview,
  labelClasses,
} from '@/runtime/dom/elementInfo.js';
import {
  DEEP_QUERY_JS,
  UNSEARCHED_CONTENT_JS,
  pageNamesJS,
  selectorArgsJS,
} from '@/runtime/dom/targetNode.js';
import type {
  DomQueryResult,
  DomGetResult,
  DomGetOptions,
  DomContext,
  ElementState,
  IndexSource,
  NodeRef,
  ViewportPosition,
} from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';
import {
  leadingCompounds,
  parseSelectorFilters,
  withoutVisibleFilters,
} from '@/utils/selectorFilters.js';
import { findSimilarNames, parseSingleNameSelector } from '@/utils/suggestions.js';

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

/** Node types whose outer HTML is read in the page: element (1) and document (9) */
const PAGE_READ_NODE_TYPES = new Set([1, 9]);

/** What {@link MASKED_OUTER_HTML_JS} reads */
interface MaskedOuterHTML {
  html: string | null;
  sensitive: boolean;
}

/**
 * A node's outer HTML with the values of secret fields masked
 * ({@link MASKED_OUTER_HTML_JS}), as `dom query` masks them. Elements and
 * documents are read in the page; other nodes (text, comments), which hold
 * no fields, with `DOM.getOuterHTML`. An element the page cannot read gets
 * no HTML rather than unmasked HTML.
 *
 * @param ref - Node reference
 * @param nodeType - DOM node type from `DOM.describeNode`
 * @returns Outer HTML (undefined if unavailable) and whether the node itself is a secret field
 */
async function maskedOuterHTML(
  ref: NodeRef,
  nodeType: number
): Promise<{ outerHTML: string | undefined; sensitive: boolean }> {
  if (!PAGE_READ_NODE_TYPES.has(nodeType)) {
    const response = await callCDP('DOM.getOuterHTML', ref);
    const outerHTML = (response.data?.result as Protocol.DOM.GetOuterHTMLResponse | undefined)
      ?.outerHTML;
    return { outerHTML, sensitive: false };
  }
  const read = (await callOnNode(
    ref,
    `function () { return (${MASKED_OUTER_HTML_JS})(this); }`
  )) as Partial<MaskedOuterHTML> | undefined;
  if (typeof read?.html !== 'string') log.debug(`No masked outer HTML for ${JSON.stringify(ref)}`);
  return {
    outerHTML: typeof read?.html === 'string' ? read.html : undefined,
    sensitive: read?.sensitive === true,
  };
}

/**
 * An element's attributes as `dom get --raw` shows them: the `value` of a
 * secret field is {@link MASKED_VALUE}.
 *
 * @param attributes - Attributes from `DOM.describeNode`
 * @param sensitive - Whether the element is a secret field
 * @returns Attributes to show
 */
function maskedAttributes(
  attributes: Record<string, string>,
  sensitive: boolean
): Record<string, string> {
  return sensitive && attributes['value'] ? { ...attributes, value: MASKED_VALUE } : attributes;
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
  const evaluated = await callBdgScript('Runtime.evaluate', {
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
 * evaluation, on this failure path only, tells what the page says about it
 * ({@link noMatchContext}).
 *
 * @param selector - Selector as given
 * @returns Message and suggestion
 */
export async function noMatchesError(selector: string): Promise<ErrorWithSuggestion> {
  return noNodesFoundError(selector, await noMatchContext(selector));
}

/**
 * Page-side index of the first leading compound that matches a shadow host
 * (an element with an open shadow root, anywhere a selector reaches) while
 * the selector after it finds something: then the selector only failed by
 * crossing into the shadow root.
 *
 * @param compounds - Leading compounds of the selector
 * @returns Expression evaluating to the index, or -1
 */
function shadowHostJS(compounds: ReadonlyArray<{ compound: string; rest: string }>): string {
  const plain = compounds
    .slice(0, MAX_HOST_COMPOUNDS)
    .map((entry) => [withoutFilters(entry.compound), withoutFilters(entry.rest)]);
  return `${JSON.stringify(plain)}.findIndex(([host, rest]) => { try { const deep = ${DEEP_QUERY_JS}; return deep(host, null).some((el) => el.shadowRoot) && deep(rest, null).length > 0; } catch (e) { return false; } })`;
}

/** Leading compounds checked for a shadow host (each check walks the page) */
const MAX_HOST_COMPOUNDS = 4;

/**
 * A selector without bdg's filters (`:visible`, `:has-text()`, `:text-is()`),
 * which plain CSS does not know.
 *
 * @param selector - Selector
 * @returns Plain CSS
 */
function withoutFilters(selector: string): string {
  return (
    selector.replace(/:visible\b|:(has-text|text-is)\((?:"[^"]*"|'[^']*'|[^)"'])*\)/g, '').trim() ||
    '*'
  );
}

/** What {@link noMatchContext} reads from the page */
interface NoMatchPageValue {
  hidden?: unknown;
  readyState?: unknown;
  unsearched?: { crossOriginFrames?: unknown; embeds?: unknown };
  names?: unknown;
  shadowHost?: unknown;
  closedCandidates?: unknown;
}

/**
 * What the page says about a selector that matched nothing, in one
 * evaluation: whether it is still loading, how many elements match with the
 * selector's `:visible` filters removed, whether it has cross-origin iframes
 * or embeds (which selectors do not search), and for a selector that is a
 * single id or class, the similar ids or classes on the page. When it has
 * custom elements that may host a closed shadow root, CDP tells which do
 * ({@link closedShadowHostNames}).
 *
 * @param selector - Selector as given
 * @returns Context for {@link noNodesFoundError} (empty when the page did not answer)
 */
export async function noMatchContext(selector: string): Promise<NoMatchContext> {
  const parts = parseSelectorFilters(selector);
  const unfiltered = parts && withoutVisibleFilters(parts);
  const single = parseSingleNameSelector(selector);
  const hidden = unfiltered
    ? `(() => { try { return (${DEEP_QUERY_JS})(${JSON.stringify(selector)}, ${JSON.stringify(unfiltered)}).length; } catch (e) { return 0; } })()`
    : '0';
  const names = single ? pageNamesJS(single.kind) : '[]';
  const compounds = leadingCompounds(selector);
  const shadowHost = compounds.length > 0 ? shadowHostJS(compounds) : '-1';
  try {
    const evaluated = await callBdgScript('Runtime.evaluate', {
      expression: `({ hidden: ${hidden}, readyState: document.readyState, unsearched: ${UNSEARCHED_CONTENT_JS}, names: ${names}, shadowHost: ${shadowHost}, closedCandidates: (() => { try { return ${CLOSED_HOST_CANDIDATES_JS}.length; } catch (e) { return 0; } })() })`,
      returnByValue: true,
    });
    const { result } = (evaluated.data?.result ?? {}) as Partial<Protocol.Runtime.EvaluateResponse>;
    const value = (result?.value ?? {}) as NoMatchPageValue;
    const similar =
      single && Array.isArray(value.names)
        ? similarSelectorsLine(
            single.kind,
            findSimilarNames(
              single.name,
              value.names.filter((n) => typeof n === 'string')
            )
          )
        : '';
    const closed =
      typeof value.closedCandidates === 'number' && value.closedCandidates > 0
        ? await closedShadowHostNames()
        : { hosts: [], capped: false };
    return {
      hidden: typeof value.hidden === 'number' ? value.hidden : 0,
      ...(typeof value.readyState === 'string' && { readyState: value.readyState }),
      ...(value.unsearched && {
        unsearched: {
          crossOriginFrames: value.unsearched.crossOriginFrames === true,
          embeds: value.unsearched.embeds === true,
          ...(closed.hosts.length > 0 && { closedShadowHosts: closed.hosts }),
          ...(closed.capped && { closedShadowHostsChecked: CLOSED_HOST_LIMIT }),
        },
      }),
      ...(similar && { similar }),
      ...(typeof value.shadowHost === 'number' &&
        compounds[value.shadowHost] && { shadowHost: compounds[value.shadowHost] }),
    };
  } catch (error) {
    log.debug(`Could not read the page after no match: ${getErrorMessage(error)}`);
    return {};
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
    const evaluated = await callBdgScript('Runtime.evaluate', {
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
export const VIEWPORT_HINT_LIMIT = 100;

/**
 * Matches `dom query` describes and caches for use by index at least, beyond
 * those it lists: describing costs a round trip per element, so a page with
 * 50000 matches is not described whole unless `--limit 0` asks for it.
 */
export const QUERY_CACHE_LIMIT = 1000;

/**
 * For the first `count` elements of a page-side array: the tag and
 * attributes, where it lives (an iframe and/or a shadow root), its text, its
 * form control state ({@link ELEMENT_STATE_JS}) and, for the first
 * {@link VIEWPORT_HINT_LIMIT}, its position relative to the viewport; plus
 * the viewport size and how many elements the array has. An element that
 * cannot be read gets empty details instead of failing the whole query.
 */
const ELEMENT_DETAILS_FUNCTION = `function (count) {
  const contextOf = ${ELEMENT_CONTEXT_JS};
  const textOf = ${ELEMENT_TEXT_JS};
  const geometryOf = ${ELEMENT_GEOMETRY_JS};
  const stateOf = ${ELEMENT_STATE_JS};
  const read = (el, index) => {
    try {
      const attributes = [];
      for (const attribute of Array.from(el.attributes || [])) attributes.push(attribute.name, attribute.value);
      return { tag: el.nodeName, attributes: attributes, context: contextOf(el), text: textOf(el), state: stateOf(el), geometry: index < ${VIEWPORT_HINT_LIMIT} ? geometryOf(el) : null };
    } catch (e) {
      return {};
    }
  };
  return { total: this.length, viewport: (${VIEWPORT_SIZE_JS})(window), elements: Array.from(Array.prototype.slice.call(this, 0, count), read) };
}`;

/** Page-side: the first `count` elements of the array, as a new array */
const SLICE_FUNCTION = `function (count) { return Array.prototype.slice.call(this, 0, count); }`;

/** One element of a selection with what `dom query` shows about it. */
interface ElementDetails {
  backendNodeId: number;
  /** Node name as CDP reports it (`DIV`, `svg`) */
  tag: string;
  /** Attributes as `[name, value, name, value, ...]` */
  attributes: string[];
  context: string;
  text: string;
  state: ElementState;
  inViewport?: ViewportPosition;
  clippedBy?: string;
}

/** What {@link ELEMENT_DETAILS_FUNCTION} returns for one element. */
interface PageElementDetails {
  tag?: string;
  attributes?: string[];
  context?: string;
  text?: string;
  state?: ElementState;
  geometry?: ElementGeometry | null;
}

/** What {@link ELEMENT_DETAILS_FUNCTION} returns. */
interface PageDetails {
  /** Elements in the array (all matches) */
  total?: number;
  viewport?: LayoutSize;
  elements?: PageElementDetails[];
}

/**
 * The first `count` elements of a page-side array with their backend node
 * ids, tag and attributes, where each lives (empty for the main document),
 * its text and its viewport position, and how many elements the array has.
 *
 * @param arrayObjectId - Remote object id of the array
 * @param count - Elements to describe (0 = all)
 * @returns Elements in array order (ones that cannot be described are left
 *   out) and the array's length
 * @throws CommandError (91) when the page could not describe the matches
 */
async function elementsWithDetails(
  arrayObjectId: string,
  count: number
): Promise<{ total: number; elements: ElementDetails[] }> {
  const limit = count === 0 ? Number.MAX_SAFE_INTEGER : count;
  const { total = 0, viewport, elements = [] } = await readPageDetails(arrayObjectId, limit);
  const ids = await elementBackendNodeIds(
    total > limit ? await sliceArray(arrayObjectId, limit) : arrayObjectId
  );
  const described = ids.flatMap((backendNodeId, index) => {
    if (backendNodeId === undefined) return [];
    const details = elements[index];
    return [
      {
        backendNodeId,
        tag: details?.tag ?? '',
        attributes: details?.attributes ?? [],
        context: details?.context ?? '',
        text: details?.text ?? '',
        state: details?.state ?? {},
        ...viewportHint(details?.geometry, viewport),
      },
    ];
  });
  return { total, elements: described };
}

/**
 * A page-side array of the first elements of another (in the same object
 * group), so only those are described.
 *
 * @param arrayObjectId - Remote object id of the array
 * @param count - Elements to keep
 * @returns Remote object id of the shorter array
 * @throws CommandError (91) when the page could not slice it
 */
async function sliceArray(arrayObjectId: string, count: number): Promise<string> {
  const response = await callCDP('Runtime.callFunctionOn', {
    objectId: arrayObjectId,
    functionDeclaration: SLICE_FUNCTION,
    arguments: [{ value: count }],
  });
  const objectId = (response.data?.result as Partial<Protocol.Runtime.CallFunctionOnResponse>)
    ?.result?.objectId;
  if (!objectId) {
    const err = operationFailedError('describe the matches', response.error ?? 'no result');
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.SCRIPT_ERROR);
  }
  return objectId;
}

/**
 * Run {@link ELEMENT_DETAILS_FUNCTION} on a page-side array.
 *
 * @param arrayObjectId - Remote object id of the array
 * @param count - Elements to describe, from the start
 * @returns Details of those elements, the array's length and the viewport size
 * @throws CommandError (91) when the script failed
 */
async function readPageDetails(arrayObjectId: string, count: number): Promise<PageDetails> {
  const response = await callCDP('Runtime.callFunctionOn', {
    objectId: arrayObjectId,
    functionDeclaration: ELEMENT_DETAILS_FUNCTION,
    arguments: [{ value: count }],
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
 * Query elements by selector for `bdg dom query`: all matches are counted,
 * and the first `limit` (at least {@link QUERY_CACHE_LIMIT}, so indices past
 * the listed ones still work) are described in one page-side pass plus one
 * `DOM.describeNode` each for their backend node id.
 *
 * @param selector - CSS selector
 * @param limit - Matches the caller lists (0 = all, so all are described)
 * @returns The match count, and the described matches with backend node
 *   ids, tags, key attributes, classes and text previews
 */
export async function queryDOMElements(selector: string, limit = 0): Promise<DomQueryResult> {
  const described = limit === 0 ? 0 : Math.max(limit, QUERY_CACHE_LIMIT);
  const { total, elements } = await withSelection(selector, (arrayObjectId) =>
    elementsWithDetails(arrayObjectId, described)
  );
  if (total > 20) log.debug(`Queried ${total} elements with selector: ${selector}`);
  return { selector, count: total, nodes: elements.map(queryNode) };
}

/**
 * One described match as `dom query` reports it.
 *
 * @param element - Match with its page-side details
 * @param index - Its position among the matches
 * @returns Query node
 */
function queryNode(
  element: ElementDetails,
  index: number
): DomQueryResult['nodes'][number] & { classes: string[] } {
  const { backendNodeId, context, text, state, inViewport, clippedBy } = element;
  const attributes = unpackAttributes(element.attributes);
  const classes = elementClasses(attributes);
  const preview = textPreview(text);
  const tag = element.tag.toLowerCase();
  const keys = keyAttributes(tag, attributes, state);
  return {
    index,
    nodeId: backendNodeId,
    tag,
    ...identifyingAttributes(attributes, element.tag),
    ...(keys && { attributes: keys }),
    classes,
    ...(preview && { preview }),
    ...(context && { context }),
    ...(inViewport && { inViewport }),
    ...(clippedBy && { clippedBy }),
  };
}

/**
 * The attributes that tell similar elements apart (form fields especially).
 *
 * @param attributes - Element attributes
 * @param nodeName - Element name (`OPTION`s also report their `value`)
 * @returns id, name and type (and an option's value) when present
 */
function identifyingAttributes(
  attributes: Record<string, string>,
  nodeName: string
): Pick<DomQueryResult['nodes'][number], 'id' | 'name' | 'type' | 'value'> {
  const value = nodeName === 'OPTION' ? attributes['value'] : undefined;
  return {
    ...(attributes['id'] && { id: attributes['id'] }),
    ...(attributes['name'] && { name: attributes['name'] }),
    ...(attributes['type'] && { type: attributes['type'] }),
    ...(value !== undefined && { value }),
  };
}

/** What {@link elementTextAndState} reads */
interface TextAndState {
  text: string;
  state: ElementState;
}

/**
 * The text of one element as the page renders it ({@link ELEMENT_TEXT_JS})
 * and its form control state ({@link ELEMENT_STATE_JS}).
 *
 * @param ref - Node reference
 * @param full - Read all of a large container's text, not just its start
 * @returns Element text and state, empty when the node cannot be read
 */
async function elementTextAndState(ref: NodeRef, full: boolean): Promise<TextAndState> {
  const value = (await callOnNode(
    ref,
    `function (full) { return { text: (${ELEMENT_TEXT_JS})(this, full), state: (${ELEMENT_STATE_JS})(this) }; }`,
    [full]
  )) as Partial<TextAndState> | undefined;
  return {
    text: typeof value?.text === 'string' ? value.text : '',
    state: value?.state ?? {},
  };
}

/**
 * Call a page-side function on a node (as `this`) and read its result by value.
 *
 * @param ref - Node reference
 * @param functionDeclaration - Function source
 * @param args - Arguments passed by value
 * @returns The result, or undefined when the node cannot be resolved
 */
async function callOnNode(
  ref: NodeRef,
  functionDeclaration: string,
  args: unknown[] = []
): Promise<unknown> {
  const objectGroup = `bdg-node-${process.pid}-${++queryCount}`;
  const resolved = await callBdgScript('DOM.resolveNode', { ...ref, objectGroup });
  const objectId = (resolved.data?.result as Protocol.DOM.ResolveNodeResponse | undefined)?.object
    .objectId;
  if (!objectId) return undefined;
  try {
    const response = await callCDP('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration,
      arguments: args.map((value) => ({ value })),
      returnByValue: true,
    });
    return (response.data?.result as { result?: { value?: unknown } } | undefined)?.result?.value;
  } finally {
    await callCDP('Runtime.releaseObjectGroup', { objectGroup });
  }
}

/**
 * Get DOM context (tag, classes, key attributes, text preview) for a node: a one-line
 * preview, and up to {@link ELEMENT_TEXT_LENGTH} characters of text when it
 * is longer (all of it with `full`).
 *
 * @param ref - Node reference
 * @param options - `full`: the whole text instead of its first 500 characters
 * @returns DOM context, or null if the node does not exist
 */
export async function getDomContext(
  ref: NodeRef,
  options: { full?: boolean } = {}
): Promise<DomContext | null> {
  await callCDP('DOM.enable', {});
  const desc = await describeNode(ref);
  if (!desc) {
    log.debug(`No DOM context for ${JSON.stringify(ref)}`);
    return null;
  }
  const full = options.full === true;
  const attributes = unpackAttributes(desc.attributes);
  const classes = elementClasses(attributes);
  const { text, state } = await elementTextAndState(ref, full);
  const preview = textPreview(text);
  const longer = textPreview(text, full ? Number.POSITIVE_INFINITY : ELEMENT_TEXT_LENGTH);
  const tag = desc.nodeName.toLowerCase();
  const keys = keyAttributes(tag, attributes, state);
  return {
    tag,
    classes,
    ...(keys && { attributes: keys }),
    ...(state.sensitive && { sensitive: true }),
    ...(preview && { preview }),
    ...(longer !== preview && { text: longer }),
    ...(!preview && (await childElements(ref))),
  };
}

/** Child elements named for an element without text */
const CHILDREN_LISTED = 5;

/** Children that show nothing themselves, left out of the listing */
const UNSHOWN_CHILD = /^(SCRIPT|STYLE|LINK|TEMPLATE)$/;

/**
 * The child elements of an element (for one without text: a body holding
 * only an iframe, an empty app root). A web component is described by its
 * shadow root's children, which is what it shows (an icon button named
 * there); scripts, styles and templates are left out.
 *
 * @param ref - Node reference
 * @returns The first {@link CHILDREN_LISTED} as `tag#id.class "label"`, how many there are, and whether they are in its shadow root (and its mode)
 */
async function childElements(
  ref: NodeRef
): Promise<Pick<DomContext, 'children' | 'childCount' | 'shadowChildren' | 'shadowRootMode'>> {
  const response = await callCDP('DOM.describeNode', { ...ref, depth: 2, pierce: true });
  const node = (response.data?.result as Protocol.DOM.DescribeNodeResponse | undefined)?.node;
  const shadowRoot = node?.shadowRoots?.find((root) => root.shadowRootType !== 'user-agent');
  const elements = ((shadowRoot ?? node)?.children ?? []).filter(
    (child) => child.nodeType === 1 && !UNSHOWN_CHILD.test(child.nodeName)
  );
  return {
    children: elements.slice(0, CHILDREN_LISTED).map(childLabel),
    childCount: elements.length,
    ...(shadowRoot && {
      shadowChildren: true,
      shadowRootMode: shadowRoot.shadowRootType === 'closed' ? 'closed' : 'open',
    }),
  };
}

/**
 * A child element in a few characters, with its aria-label when it has one.
 *
 * @param node - Child node
 * @returns e.g. `iframe#app.full`, `button.icon "Close"`
 */
function childLabel(node: Protocol.DOM.Node): string {
  const attributes = unpackAttributes(node.attributes);
  const id = attributes['id'] ? `#${attributes['id']}` : '';
  const { shown } = labelClasses(elementClasses(attributes), 2);
  const label = attributes['aria-label']?.trim();
  return `${node.nodeName.toLowerCase()}${id}${shown.map((name) => `.${name}`).join('')}${label ? ` "${label}"` : ''}`;
}

/**
 * All matches of a selector.
 *
 * @param selector - CSS selector
 * @returns Backend node ids of the matches (at least one)
 * @throws CommandError (83) when nothing matches
 */
async function selectMatches(selector: string): Promise<number[]> {
  const backendNodeIds = await selectAll(selector);
  if (backendNodeIds.length > 0) return backendNodeIds;
  const err = await noMatchesError(selector);
  throw new CommandError(
    err.message,
    { suggestion: err.suggestion },
    EXIT_CODES.RESOURCE_NOT_FOUND
  );
}

/**
 * One match of a selector.
 *
 * @param selector - CSS selector
 * @param index - Which match (0-based)
 * @returns Its backend node id
 * @throws CommandError (83) when nothing matches, (81) for an index beyond the matches
 */
export async function selectMatch(selector: string, index = 0): Promise<number> {
  const backendNodeIds = await selectMatches(selector);
  const backendNodeId = backendNodeIds[index];
  if (backendNodeId !== undefined) return backendNodeId;
  const err = indexOutOfRangeError(index, backendNodeIds.length - 1);
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.INVALID_ARGUMENTS);
}

/**
 * Pick the nodes `dom get --raw` should report for a selector.
 *
 * @param selector - CSS selector
 * @param options - `nth` / `all` options
 * @returns Node references to describe
 */
async function selectForGet(selector: string, options: DomGetOptions): Promise<NodeRef[]> {
  if (options.all) {
    return (await selectMatches(selector)).map((backendNodeId) => ({ backendNodeId }));
  }
  return [{ backendNodeId: await selectMatch(selector, options.nth ?? 0) }];
}

/**
 * Get full details (attributes, outer HTML) for `bdg dom get --raw`, with
 * the values of secret fields masked as `dom query` masks them.
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
    const { outerHTML, sensitive } = await maskedOuterHTML(ref, desc.nodeType);
    const attributes = maskedAttributes(unpackAttributes(desc.attributes), sensitive);
    const classes = elementClasses(attributes);
    return {
      nodeId: desc.backendNodeId,
      tag: desc.nodeName.toLowerCase(),
      ...(Object.keys(attributes).length > 0 && { attributes }),
      classes,
      ...(outerHTML && { outerHTML }),
    };
  });

  return { nodes };
}

/**
 * Resolve a selector to its first match.
 *
 * @param selector - CSS selector
 * @returns Backend node id of the first match
 * @throws CommandError (83) when nothing matches
 */
export async function resolveSelector(selector: string): Promise<number> {
  const backendNodeId = (await selectAll(selector))[0];
  if (backendNodeId === undefined) {
    const err = await noMatchesError(selector);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }
  return backendNodeId;
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
 * Check that a cached element is still part of the current page.
 *
 * `DOM.describeNode` still answers for nodes of a previous document, so
 * existence is checked by resolving the node into the page's JavaScript
 * context, which fails for other documents, and by `isConnected`, which is
 * false for removed elements.
 *
 * @param backendNodeId - Backend node id from the query cache
 * @param source - Index the user gave and the list it refers to, for the error message
 * @throws CommandError (87) when the element is gone
 */
export async function assertNodeAttached(
  backendNodeId: number,
  source?: IndexSource
): Promise<void> {
  const resolved = await callBdgScript('DOM.resolveNode', {
    backendNodeId,
    objectGroup: 'bdg-check',
  });
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
    const err = staleNodeError(source?.index, source);
    throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.STALE_CACHE);
  }
}

/**
 * Identity of the page's current document: its time origin, which every
 * document load gets anew. Cached backend node ids belong to one document; a
 * page loaded in a new renderer process reuses the same ids for other
 * elements, so an index of an older document must not be used.
 *
 * @returns The identity, or undefined when the page cannot be asked
 * @throws CommandError when the page is busy (102) or crashed (107), as the
 *   command itself would
 */
export async function pageDocumentId(): Promise<string | undefined> {
  try {
    const evaluated = await callBdgScript('Runtime.evaluate', {
      expression: 'String(performance.timeOrigin)',
      returnByValue: true,
    });
    const { result } = (evaluated.data?.result ?? {}) as Partial<Protocol.Runtime.EvaluateResponse>;
    return typeof result?.value === 'string' ? result.value : undefined;
  } catch (error) {
    if (error instanceof CommandError) throw error;
    log.debug(`Page document not identified: ${getErrorMessage(error)}`);
    return undefined;
  }
}
