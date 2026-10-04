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
  staleNodeError,
} from '@/errors/messages.js';
import { callCDP } from '@/ipc/client.js';
import { DEEP_QUERY_JS } from '@/runtime/dom/targetNode.js';
import { resolveA11yNode } from '@/telemetry/a11y.js';
import type {
  A11yNode,
  DomQueryResult,
  DomGetResult,
  DomGetOptions,
  DomContext,
  NodeRef,
} from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/** Maximum concurrent CDP calls to avoid overwhelming the connection. */
const CDP_CONCURRENCY_LIMIT = 10;

/** Length of the text preview shown for queried elements. */
const PREVIEW_LENGTH = 80;

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

/**
 * Short text preview of an element's content.
 *
 * @param outerHTML - Element HTML
 * @returns Collapsed text, truncated to {@link PREVIEW_LENGTH}
 */
function textPreview(outerHTML: string): string {
  const text = outerHTML
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, PREVIEW_LENGTH) + (text.length > PREVIEW_LENGTH ? '...' : '');
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
    expression: `(${DEEP_QUERY_JS})(${JSON.stringify(selector)})`,
    objectGroup,
  });
  try {
    return await use(selectionObjectId(selector, evaluated));
  } finally {
    await callCDP('Runtime.releaseObjectGroup', { objectGroup });
  }
}

/** Where each element of a page-side array lives: an iframe and/or a shadow root */
const ELEMENT_CONTEXTS_FUNCTION = `function () {
  const describe = (node) => node.tagName.toLowerCase() + (node.id ? '#' + node.id : '');
  return Array.from(this, (el) => {
    const parts = [];
    for (let doc = el.ownerDocument; doc && doc.defaultView && doc.defaultView.frameElement; ) {
      const frame = doc.defaultView.frameElement;
      parts.unshift(describe(frame));
      doc = frame.ownerDocument;
    }
    const root = el.getRootNode();
    if (root.host) parts.push('shadow root of <' + describe(root.host) + '>');
    return parts.join(' > ');
  });
}`;

/**
 * Backend node ids of the elements in a page-side array, each with where it
 * lives (empty for the main document).
 *
 * @param arrayObjectId - Remote object id of the array
 * @returns Elements in array order (ones that cannot be described are left out)
 */
async function elementsWithContexts(
  arrayObjectId: string
): Promise<Array<{ backendNodeId: number; context: string }>> {
  const response = await callCDP('Runtime.callFunctionOn', {
    objectId: arrayObjectId,
    functionDeclaration: ELEMENT_CONTEXTS_FUNCTION,
    returnByValue: true,
  });
  const value = (response.data?.result as { result?: { value?: unknown } } | undefined)?.result
    ?.value;
  const contexts = Array.isArray(value) ? value.map(String) : [];
  const ids = await elementBackendNodeIds(arrayObjectId);
  return ids.flatMap((backendNodeId, index) =>
    backendNodeId === undefined ? [] : [{ backendNodeId, context: contexts[index] ?? '' }]
  );
}

/**
 * The page-side array of a selector query, or the error explaining why there
 * is none: a selector the browser rejects (a `SyntaxError` DOMException) is the
 * user's (81); anything else (no session, a page navigating away) is not.
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
    const detail = description.split('\n')[0];
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
  const { backendNodeIds, contexts } = await withSelection(selector, async (arrayObjectId) => {
    const elements = await elementsWithContexts(arrayObjectId);
    return {
      backendNodeIds: elements.map((element) => element.backendNodeId),
      contexts: elements.map((element) => element.context),
    };
  });
  if (backendNodeIds.length > 20) {
    log.debug(`Querying ${backendNodeIds.length} elements with selector: ${selector}`);
  }

  const nodes = await mapConcurrently(backendNodeIds, async (backendNodeId, index) => {
    const desc = await describeNode({ backendNodeId });
    if (!desc) return { index, nodeId: 0 };
    const attributes = unpackAttributes(desc.attributes);
    const classes = attributes['class']?.split(/\s+/).filter(Boolean);
    const preview = textPreview((await getOuterHTML({ backendNodeId })) ?? '');
    const context = contexts[index];
    return {
      index,
      nodeId: desc.backendNodeId,
      tag: desc.nodeName.toLowerCase(),
      ...identifyingAttributes(attributes),
      ...(classes && { classes }),
      ...(preview && { preview }),
      ...(context && { context }),
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
  const preview = textPreview((await getOuterHTML(ref)) ?? '');
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
    const err = noNodesFoundError(selector);
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
      'bdg dom get <selector> or bdg dom get --node-id <id>'
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
    const err = noNodesFoundError(selector);
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
