/**
 * DOM helpers using CDP relay pattern.
 *
 * Provides query, get, and screenshot functionality using the worker's persistent CDP connection.
 * All operations go through IPC callCDP() for optimal performance.
 */

import { CDPConnectionError } from '@/connection/errors.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { callCDP } from '@/ipc/client.js';
import type {
  DomQueryResult,
  DomGetResult,
  ScreenshotResult,
  DomGetOptions,
  ScreenshotOptions,
  DomContext,
} from '@/types/dom.js';
import { CommandError } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

/**
 * Successful result of resolving a selector or index argument.
 */
export interface ElementTargetSuccess {
  /** Resolution succeeded */
  success: true;
  /** CSS selector to use */
  selector: string;
  /** 1-based index for selector (if resolved from cached query) */
  index?: number | undefined;
}

/**
 * Failed result of resolving a selector or index argument.
 */
export interface ElementTargetFailure {
  /** Resolution failed */
  success: false;
  /** Error message */
  error: string;
  /** Exit code for the error */
  exitCode: number;
  /** Suggestion for fixing the error */
  suggestion?: string | undefined;
}

/**
 * Result of resolving a selector or index argument to an element target.
 * Discriminated union that guarantees selector exists when success is true.
 */
export type ElementTargetResult = ElementTargetSuccess | ElementTargetFailure;

/**
 * Resolve a selectorOrIndex argument to an element target.
 *
 * Handles the common pattern of accepting either:
 * - A CSS selector string (used directly)
 * - A numeric index (resolved from cached query results)
 *
 * @param selectorOrIndex - CSS selector or numeric index from query results
 * @param explicitIndex - Optional explicit --index flag value (1-based)
 * @returns Resolution result with selector and optional index
 *
 * @example
 * ```typescript
 * const target = await resolveElementTarget('button');
 * // { success: true, selector: 'button' }
 *
 * const target = await resolveElementTarget('0');
 * // { success: true, selector: '.cached-selector', index: 1 }
 * ```
 */
export async function resolveElementTarget(
  selectorOrIndex: string,
  explicitIndex?: number
): Promise<ElementTargetResult> {
  const isNumericIndex = /^\d+$/.test(selectorOrIndex);

  if (isNumericIndex) {
    const { getSessionQueryCache } = await import('@/session/queryCache.js');
    const cachedQuery = getSessionQueryCache();

    if (!cachedQuery) {
      return {
        success: false,
        error: 'No cached query results found',
        exitCode: EXIT_CODES.INVALID_ARGUMENTS,
        suggestion: 'Run "bdg dom query <selector>" first to generate indexed results',
      };
    }

    const index = parseInt(selectorOrIndex, 10);
    if (index < 0 || index >= cachedQuery.nodes.length) {
      return {
        success: false,
        error: `Index ${index} out of range (found ${cachedQuery.nodes.length} elements)`,
        exitCode: EXIT_CODES.INVALID_ARGUMENTS,
        suggestion: `Use an index between 0 and ${cachedQuery.nodes.length - 1}`,
      };
    }

    return {
      success: true,
      selector: cachedQuery.selector,
      index: index + 1,
    };
  }

  return {
    success: true,
    selector: selectorOrIndex,
    index: explicitIndex,
  };
}

export type {
  DomQueryResult,
  DomGetResult,
  ScreenshotResult,
  DomGetOptions,
  ScreenshotOptions,
  DomContext,
};

/**
 * Maximum concurrent CDP calls for DOM operations.
 * Prevents overwhelming CDP connection with too many simultaneous requests.
 */
const CDP_CONCURRENCY_LIMIT = 10;

/**
 * Query DOM elements by CSS selector using CDP relay.
 *
 * @param selector - CSS selector to query
 * @returns Query result with matched nodes
 * @throws CDPConnectionError if CDP operation fails
 */
export async function queryDOMElements(selector: string): Promise<DomQueryResult> {
  await callCDP('DOM.enable', {});

  const docResponse = await callCDP('DOM.getDocument', {});
  const doc = docResponse.data?.result as Protocol.DOM.GetDocumentResponse | undefined;
  if (!doc?.root?.nodeId) {
    throw new CDPConnectionError('Failed to get document root', new Error('No root node'));
  }

  const queryResponse = await callCDP('DOM.querySelectorAll', {
    nodeId: doc.root.nodeId,
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

        const attributes: Record<string, string> = {};
        if (nodeDesc.attributes) {
          for (let i = 0; i < nodeDesc.attributes.length; i += 2) {
            const key = nodeDesc.attributes[i];
            const value = nodeDesc.attributes[i + 1];
            if (key !== undefined && value !== undefined) {
              attributes[key] = value;
            }
          }
        }

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
        } = { index, nodeId };

        if (tag) node.tag = tag;
        if (classes) node.classes = classes;
        if (preview) node.preview = preview;

        return node;
      })
    )
  );

  return {
    selector,
    count: nodes.length,
    nodes,
  };
}

/**
 * Fetch DOM context (tag, classes, text preview) for a node by its nodeId.
 *
 * Used to enrich semantic output when a11y name is missing.
 *
 * @param nodeId - CDP node ID
 * @returns DOM context with tag, classes, and text preview
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

    const attributes: Record<string, string> = {};
    if (nodeDesc.attributes) {
      for (let i = 0; i < nodeDesc.attributes.length; i += 2) {
        const key = nodeDesc.attributes[i];
        const value = nodeDesc.attributes[i + 1];
        if (key !== undefined && value !== undefined) {
          attributes[key] = value;
        }
      }
    }

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
    log.debug(`Failed to get DOM context for nodeId ${nodeId}: ${String(error)}`);
    return null;
  }
}

/**
 * Get full HTML and attributes for DOM elements using CDP relay.
 *
 * @param options - Get options (selector or nodeId, plus optional --all or --nth flags)
 * @returns Get result with node details
 * @throws CDPConnectionError if CDP operation fails
 */
export async function getDOMElements(options: DomGetOptions): Promise<DomGetResult> {
  await callCDP('DOM.enable', {});

  let nodeIds: number[] = [];

  if (options.nodeId !== undefined) {
    nodeIds = [options.nodeId];
  } else if (options.selector) {
    const docResponse = await callCDP('DOM.getDocument', {});
    const doc = docResponse.data?.result as Protocol.DOM.GetDocumentResponse | undefined;
    if (!doc?.root?.nodeId) {
      throw new CDPConnectionError('Failed to get document root', new Error('No root node'));
    }

    const queryResponse = await callCDP('DOM.querySelectorAll', {
      nodeId: doc.root.nodeId,
      selector: options.selector,
    });
    const queryResult = queryResponse.data?.result as
      | Protocol.DOM.QuerySelectorAllResponse
      | undefined;
    nodeIds = queryResult?.nodeIds ?? [];

    if (nodeIds.length === 0) {
      throw new CommandError(
        `No elements found matching "${options.selector}"`,
        { suggestion: 'Verify the CSS selector is correct' },
        EXIT_CODES.RESOURCE_NOT_FOUND
      );
    }

    if (options.nth !== undefined) {
      if (options.nth < 1 || options.nth > nodeIds.length) {
        throw new CommandError(
          `--nth ${options.nth} out of range (found ${nodeIds.length} elements)`,
          { suggestion: `Use a value between 1 and ${nodeIds.length}` },
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }
      const nthNode = nodeIds[options.nth - 1];
      if (nthNode === undefined) {
        throw new CommandError(
          `Element at index ${options.nth} not found`,
          {},
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
      }
      nodeIds = [nthNode];
    } else if (!options.all) {
      const firstNode = nodeIds[0];
      if (firstNode === undefined) {
        throw new CommandError('No elements found', {}, EXIT_CODES.RESOURCE_NOT_FOUND);
      }
      nodeIds = [firstNode];
    }
  } else {
    throw new CommandError(
      'Either selector or nodeId must be provided',
      {},
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

        const attributes: Record<string, string> = {};
        if (nodeDesc.attributes) {
          for (let i = 0; i < nodeDesc.attributes.length; i += 2) {
            const key = nodeDesc.attributes[i];
            const value = nodeDesc.attributes[i + 1];
            if (key !== undefined && value !== undefined) {
              attributes[key] = value;
            }
          }
        }

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
        } = { nodeId };

        if (tag) node.tag = tag;
        if (Object.keys(attributes).length > 0) node.attributes = attributes;
        if (classes) node.classes = classes;
        if (outerHTML) node.outerHTML = outerHTML;

        return node;
      })
    )
  );

  return { nodes };
}

/**
 * Capture a screenshot of the page using CDP relay.
 *
 * @param outputPath - Path to save screenshot
 * @param options - Screenshot options (format, quality, fullPage)
 * @returns Screenshot result with path, format, dimensions, and size
 * @throws CDPConnectionError if CDP operation fails
 */
export async function capturePageScreenshot(
  outputPath: string,
  options: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
  const format = options.format ?? 'png';
  const quality = format === 'jpeg' ? (options.quality ?? 90) : undefined;
  const fullPage = options.fullPage ?? true;

  const metricsResponse = await callCDP('Page.getLayoutMetrics', {});
  const metricsResult = metricsResponse.data?.result as
    | Protocol.Page.GetLayoutMetricsResponse
    | undefined;

  const contentSize = metricsResult?.contentSize ?? { width: 0, height: 0 };
  const viewport = metricsResult?.visualViewport ?? { clientWidth: 0, clientHeight: 0 };

  const screenshotResponse = await callCDP('Page.captureScreenshot', {
    format,
    ...(quality !== undefined && { quality }),
    captureBeyondViewport: fullPage,
  });

  const screenshotResult = screenshotResponse.data?.result as
    | Protocol.Page.CaptureScreenshotResponse
    | undefined;

  if (!screenshotResult?.data) {
    throw new CDPConnectionError('No screenshot data returned', new Error('Empty response'));
  }

  const path = await import('path');
  const { AtomicFileWriter } = await import('@/utils/atomicFile.js');
  const buffer = Buffer.from(screenshotResult.data, 'base64');

  const absolutePath = path.resolve(outputPath);
  await AtomicFileWriter.writeBufferAsync(absolutePath, buffer);

  const result: ScreenshotResult = {
    path: absolutePath,
    format,
    width: fullPage ? contentSize.width : viewport.clientWidth,
    height: fullPage ? contentSize.height : viewport.clientHeight,
    size: buffer.length,
    fullPage,
  };

  if (quality !== undefined) {
    result.quality = quality;
  }

  if (!fullPage) {
    result.viewport = {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    };
  }

  return result;
}
