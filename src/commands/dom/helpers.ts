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
} from '@/types/dom.js';
import { CommandError } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

// Re-export types for backward compatibility
export type { DomQueryResult, DomGetResult, ScreenshotResult, DomGetOptions, ScreenshotOptions };

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
  // Enable DOM domain
  await callCDP('DOM.enable', {});

  // Get document root
  const docResponse = await callCDP('DOM.getDocument', {});
  const doc = docResponse.data?.result as Protocol.DOM.GetDocumentResponse | undefined;
  if (!doc?.root?.nodeId) {
    throw new CDPConnectionError('Failed to get document root', new Error('No root node'));
  }

  // Query selector
  const queryResponse = await callCDP('DOM.querySelectorAll', {
    nodeId: doc.root.nodeId,
    selector,
  });
  const queryResult = queryResponse.data?.result as
    | Protocol.DOM.QuerySelectorAllResponse
    | undefined;
  const nodeIds = queryResult?.nodeIds ?? [];

  // Log progress for large queries
  if (nodeIds.length > 20) {
    log.debug(`Querying ${nodeIds.length} elements with selector: ${selector}`);
  }

  // Get info for each node with concurrency control
  const limiter = new ConcurrencyLimiter(CDP_CONCURRENCY_LIMIT);
  const nodes = await Promise.all(
    nodeIds.map((nodeId, index) =>
      limiter.run(async () => {
        // Describe node
        const descResponse = await callCDP('DOM.describeNode', { nodeId });
        const descResult = descResponse.data?.result as
          | Protocol.DOM.DescribeNodeResponse
          | undefined;
        const nodeDesc = descResult?.node;

        if (!nodeDesc) {
          return { index, nodeId };
        }

        // Parse attributes
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

        // Extract classes and create preview
        const classes = attributes['class']?.split(/\s+/).filter((c) => c.length > 0);
        const tag = nodeDesc.nodeName.toLowerCase();

        // Get outer HTML for preview
        const htmlResponse = await callCDP('DOM.getOuterHTML', { nodeId });
        const htmlResult = htmlResponse.data?.result as
          | Protocol.DOM.GetOuterHTMLResponse
          | undefined;
        const outerHTML = htmlResult?.outerHTML ?? '';

        // Create preview text
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
    // Get document root
    const docResponse = await callCDP('DOM.getDocument', {});
    const doc = docResponse.data?.result as Protocol.DOM.GetDocumentResponse | undefined;
    if (!doc?.root?.nodeId) {
      throw new CDPConnectionError('Failed to get document root', new Error('No root node'));
    }

    // Query selector
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

    // Apply filtering
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
      // Default: return first match only
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

  // Log progress for large fetches
  if (nodeIds.length > 20) {
    log.debug(`Fetching details for ${nodeIds.length} DOM elements`);
  }

  // Fetch node details with concurrency control
  const limiter = new ConcurrencyLimiter(CDP_CONCURRENCY_LIMIT);
  const nodes = await Promise.all(
    nodeIds.map((nodeId) =>
      limiter.run(async () => {
        // Describe node
        const descResponse = await callCDP('DOM.describeNode', { nodeId });
        const descResult = descResponse.data?.result as
          | Protocol.DOM.DescribeNodeResponse
          | undefined;
        const nodeDesc = descResult?.node;

        if (!nodeDesc) {
          return { nodeId };
        }

        // Parse attributes
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

        // Extract classes
        const classes = attributes['class']?.split(/\s+/).filter((c) => c.length > 0);
        const tag = nodeDesc.nodeName.toLowerCase();

        // Get outer HTML
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

  // Get viewport dimensions
  const metricsResponse = await callCDP('Page.getLayoutMetrics', {});
  const metricsResult = metricsResponse.data?.result as
    | Protocol.Page.GetLayoutMetricsResponse
    | undefined;

  const contentSize = metricsResult?.contentSize ?? { width: 0, height: 0 };
  const viewport = metricsResult?.visualViewport ?? { clientWidth: 0, clientHeight: 0 };

  // Capture screenshot
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
