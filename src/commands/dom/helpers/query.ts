/**
 * CDP-relay helpers for DOM query and read operations.
 *
 * Covers `bdg dom query` (find by selector) and `bdg dom get` (read details)
 * plus selector → nodeId resolution and single-node DOM context lookups.
 */

import { CDPConnectionError } from '@/connection/errors.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  noNodesFoundError,
  indexOutOfRangeError,
  eitherArgumentRequiredError,
} from '@/errors/messages.js';
import { callCDP } from '@/ipc/client.js';
import type { DomEventListenerSummary } from '@/ipc/protocol/domTypes.js';
import {
  inspectElementEventListeners,
  type EventListenerCDPSender,
} from '@/runtime/dom/eventListeners.js';
import type { DomQueryResult, DomGetResult, DomGetOptions, DomContext } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/** Maximum concurrent CDP calls to avoid overwhelming the connection. */
const CDP_CONCURRENCY_LIMIT = 10;

const ipcCdpSender: EventListenerCDPSender = {
  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const response = await callCDP(method, params);
    return response.data?.result ?? {};
  },
};

/**
 * Enable the DOM domain and fetch the document root nodeId.
 * Every selector-based operation needs this first.
 */
async function getDocumentRootId(): Promise<number> {
  await callCDP('DOM.enable', {});

  const docResponse = await callCDP('DOM.getDocument', {});
  const doc = docResponse.data?.result as Protocol.DOM.GetDocumentResponse | undefined;
  if (!doc?.root?.nodeId) {
    throw new CDPConnectionError('Failed to get document root', new Error('No root node'));
  }
  return doc.root.nodeId;
}

/**
 * Convert CDP's flat attribute array `["k1","v1","k2","v2"]` into an object.
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
 * Query DOM elements by CSS selector via CDP relay.
 */
export async function queryDOMElements(
  selector: string,
  options: { interactive?: boolean } = {}
): Promise<DomQueryResult> {
  const rootNodeId = await getDocumentRootId();

  const queryResponse = await callCDP('DOM.querySelectorAll', {
    nodeId: rootNodeId,
    selector,
  });
  const queryResult = queryResponse.data?.result as
    | Protocol.DOM.QuerySelectorAllResponse
    | undefined;
  const nodeIds = queryResult?.nodeIds ?? [];

  if (nodeIds.length > 20) {
    log.debug(`Querying ${nodeIds.length} elements with selector: ${selector}`);
  }

  const limiter = new ConcurrencyLimiter(CDP_CONCURRENCY_LIMIT);
  const nodes = await Promise.all(
    nodeIds.map((nodeId, index) =>
      limiter.run(async () => {
        const descResponse = await callCDP('DOM.describeNode', { nodeId });
        const descResult = descResponse.data?.result as
          | Protocol.DOM.DescribeNodeResponse
          | undefined;
        const nodeDesc = descResult?.node;

        if (!nodeDesc) {
          return { index, nodeId };
        }

        const attributes = unpackAttributes(nodeDesc.attributes);
        const classes = attributes['class']?.split(/\s+/).filter((c) => c.length > 0);
        const tag = nodeDesc.nodeName.toLowerCase();

        const htmlResponse = await callCDP('DOM.getOuterHTML', { nodeId });
        const htmlResult = htmlResponse.data?.result as
          | Protocol.DOM.GetOuterHTMLResponse
          | undefined;
        const outerHTML = htmlResult?.outerHTML ?? '';

        const textContent = outerHTML
          .replace(/<[^>]*>/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const preview = textContent.slice(0, 80) + (textContent.length > 80 ? '...' : '');

        const node: {
          index: number;
          nodeId: number;
          tag?: string;
          classes?: string[];
          preview?: string;
          eventListeners?: DomEventListenerSummary;
        } = { index, nodeId };

        if (tag) node.tag = tag;
        if (classes) node.classes = classes;
        if (preview) node.preview = preview;
        if (options.interactive) {
          node.eventListeners = await inspectElementEventListeners(ipcCdpSender, nodeId, {
            includeParent: true,
          });
        }

        return node;
      })
    )
  );

  const filteredNodes = options.interactive
    ? nodes.filter((node) => node.eventListeners?.hasInteractionListeners)
    : nodes;

  return {
    selector,
    count: filteredNodes.length,
    nodes: filteredNodes,
  };
}

/**
 * Fetch DOM context (tag, classes, preview) for a nodeId. Used to enrich
 * semantic output when the a11y name is missing.
 */
export async function getDomContext(nodeId: number): Promise<DomContext | null> {
  try {
    await callCDP('DOM.enable', {});

    const descResponse = await callCDP('DOM.describeNode', { nodeId });
    const descResult = descResponse.data?.result as Protocol.DOM.DescribeNodeResponse | undefined;
    const nodeDesc = descResult?.node;

    if (!nodeDesc) {
      return null;
    }

    const attributes = unpackAttributes(nodeDesc.attributes);
    const classes = attributes['class']?.split(/\s+/).filter((c) => c.length > 0);
    const tag = nodeDesc.nodeName.toLowerCase();

    const htmlResponse = await callCDP('DOM.getOuterHTML', { nodeId });
    const htmlResult = htmlResponse.data?.result as Protocol.DOM.GetOuterHTMLResponse | undefined;
    const outerHTML = htmlResult?.outerHTML ?? '';

    const textContent = outerHTML
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const preview = textContent.slice(0, 80) + (textContent.length > 80 ? '...' : '');

    const context: DomContext = { tag };
    if (classes && classes.length > 0) context.classes = classes;
    if (preview) context.preview = preview;

    return context;
  } catch (error) {
    log.debug(`Failed to get DOM context for nodeId ${nodeId}: ${getErrorMessage(error)}`);
    return null;
  }
}

/**
 * Fetch full details (HTML, attributes, classes) for one or more elements.
 */
export async function getDOMElements(options: DomGetOptions): Promise<DomGetResult> {
  let nodeIds: number[] = [];

  if (options.nodeId !== undefined) {
    await callCDP('DOM.enable', {});
    nodeIds = [options.nodeId];
  } else if (options.selector) {
    const rootNodeId = await getDocumentRootId();

    const queryResponse = await callCDP('DOM.querySelectorAll', {
      nodeId: rootNodeId,
      selector: options.selector,
    });
    const queryResult = queryResponse.data?.result as
      | Protocol.DOM.QuerySelectorAllResponse
      | undefined;
    nodeIds = queryResult?.nodeIds ?? [];

    if (nodeIds.length === 0) {
      const err = noNodesFoundError(options.selector);
      throw new CommandError(
        err.message,
        { suggestion: err.suggestion },
        EXIT_CODES.RESOURCE_NOT_FOUND
      );
    }

    if (options.nth !== undefined) {
      if (options.nth < 0 || options.nth >= nodeIds.length) {
        const err = indexOutOfRangeError(options.nth, nodeIds.length - 1);
        throw new CommandError(
          err.message,
          { suggestion: err.suggestion },
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }
      const nthNode = nodeIds[options.nth];
      if (nthNode === undefined) {
        const err = indexOutOfRangeError(options.nth, nodeIds.length - 1);
        throw new CommandError(
          err.message,
          { suggestion: err.suggestion },
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
      }
      nodeIds = [nthNode];
    } else if (!options.all) {
      const firstNode = nodeIds[0];
      if (firstNode === undefined) {
        const err = noNodesFoundError(options.selector ?? '');
        throw new CommandError(
          err.message,
          { suggestion: err.suggestion },
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
      }
      nodeIds = [firstNode];
    }
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

  if (nodeIds.length > 20) {
    log.debug(`Fetching details for ${nodeIds.length} DOM elements`);
  }

  const limiter = new ConcurrencyLimiter(CDP_CONCURRENCY_LIMIT);
  const nodes = await Promise.all(
    nodeIds.map((nodeId) =>
      limiter.run(async () => {
        const descResponse = await callCDP('DOM.describeNode', { nodeId });
        const descResult = descResponse.data?.result as
          | Protocol.DOM.DescribeNodeResponse
          | undefined;
        const nodeDesc = descResult?.node;

        if (!nodeDesc) {
          return { nodeId };
        }

        const attributes = unpackAttributes(nodeDesc.attributes);
        const classes = attributes['class']?.split(/\s+/).filter((c) => c.length > 0);
        const tag = nodeDesc.nodeName.toLowerCase();

        const htmlResponse = await callCDP('DOM.getOuterHTML', { nodeId });
        const htmlResult = htmlResponse.data?.result as
          | Protocol.DOM.GetOuterHTMLResponse
          | undefined;
        const outerHTML = htmlResult?.outerHTML;

        const node: {
          nodeId: number;
          tag?: string;
          attributes?: Record<string, unknown>;
          classes?: string[];
          outerHTML?: string;
          eventListeners?: DomEventListenerSummary;
        } = { nodeId };

        if (tag) node.tag = tag;
        if (Object.keys(attributes).length > 0) node.attributes = attributes;
        if (classes) node.classes = classes;
        if (outerHTML) node.outerHTML = outerHTML;
        node.eventListeners = await inspectElementEventListeners(ipcCdpSender, nodeId, {
          includeParent: true,
        });

        return node;
      })
    )
  );

  return { nodes };
}

/**
 * Resolve a CSS selector to a single CDP nodeId.
 */
export async function resolveSelector(selector: string): Promise<number> {
  const rootNodeId = await getDocumentRootId();

  const queryResponse = await callCDP('DOM.querySelector', {
    nodeId: rootNodeId,
    selector,
  });
  const queryResult = queryResponse.data?.result as Protocol.DOM.QuerySelectorResponse | undefined;

  if (!queryResult?.nodeId) {
    const err = noNodesFoundError(selector);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }

  return queryResult.nodeId;
}
