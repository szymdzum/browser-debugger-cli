/**
 * DOM helpers using CDP relay pattern.
 *
 * Provides query, get, and screenshot functionality using the worker's persistent CDP connection.
 * All operations go through IPC callCDP() for optimal performance.
 */

import {
  calculateImageTokens,
  calculateResizeScale,
  isTallPage,
  shouldResize,
} from '@/commands/dom/screenshotResize.js';
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
  ElementBounds,
} from '@/types.js';
import { CommandError } from '@/ui/errors/index.js';
import { createLogger } from '@/ui/logging/index.js';
import { ConcurrencyLimiter } from '@/utils/concurrency.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';


const log = createLogger('dom');

export type {
  DomQueryResult,
  DomGetResult,
  ScreenshotResult,
  DomGetOptions,
  ScreenshotOptions,
  DomContext,
  ElementBounds,
};

/**
 * Maximum concurrent CDP calls for DOM operations.
 * Prevents overwhelming CDP connection with too many simultaneous requests.
 */
const CDP_CONCURRENCY_LIMIT = 10;

/**
 * Scroll an element into view before capture.
 *
 * @param selector - CSS selector of element to scroll to
 * @throws CommandError if element not found
 */
async function scrollToElement(selector: string): Promise<void> {
  const result = await callCDP('Runtime.evaluate', {
    expression: `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { found: false };
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        return { found: true };
      })()
    `,
    returnByValue: true,
  });

  const value = (result.data?.result as { result?: { value?: { found?: boolean } } })?.result
    ?.value;
  if (!value?.found) {
    throw new CommandError(
      `Element not found: ${selector}`,
      { suggestion: 'Verify the selector matches an element on the page' },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 50));
}

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
    log.debug(`Failed to get DOM context for nodeId ${nodeId}: ${getErrorMessage(error)}`);
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
        `No nodes found matching "${options.selector}"`,
        { suggestion: 'Verify the CSS selector is correct' },
        EXIT_CODES.RESOURCE_NOT_FOUND
      );
    }

    if (options.nth !== undefined) {
      if (options.nth < 0 || options.nth >= nodeIds.length) {
        throw new CommandError(
          `--nth ${options.nth} out of range (found ${nodeIds.length} nodes)`,
          { suggestion: `Use a value between 0 and ${nodeIds.length - 1}` },
          EXIT_CODES.INVALID_ARGUMENTS
        );
      }
      const nthNode = nodeIds[options.nth];
      if (nthNode === undefined) {
        throw new CommandError(
          `Element at index ${options.nth} not found`,
          { suggestion: `Use --index between 0 and ${nodeIds.length - 1}` },
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
      }
      nodeIds = [nthNode];
    } else if (!options.all) {
      const firstNode = nodeIds[0];
      if (firstNode === undefined) {
        throw new CommandError(
          'No nodes found',
          { suggestion: 'Verify the selector matches elements on the page' },
          EXIT_CODES.RESOURCE_NOT_FOUND
        );
      }
      nodeIds = [firstNode];
    }
  } else {
    throw new CommandError(
      'Either selector or nodeId must be provided',
      { suggestion: 'Use: bdg dom get <selector> or bdg dom get --node-id <id>' },
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
 * By default, auto-resizes images exceeding 1568px on longest edge to optimize
 * for Claude Vision token cost (~1,600 tokens max). Tall pages (aspect ratio > 3:1)
 * automatically fall back to viewport capture. Use noResize option to disable.
 *
 * @param outputPath - Path to save screenshot
 * @param options - Screenshot options (format, quality, fullPage, noResize, scroll)
 * @returns Screenshot result with path, format, dimensions, size, and capture metadata
 * @throws CDPConnectionError if CDP operation fails
 */
export async function capturePageScreenshot(
  outputPath: string,
  options: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
  const format = options.format ?? 'png';
  const quality = format === 'jpeg' ? (options.quality ?? 90) : undefined;
  const requestedFullPage = options.fullPage ?? true;
  const noResize = options.noResize ?? false;

  if (options.scroll) {
    await scrollToElement(options.scroll);
  }

  const dprResponse = await callCDP('Runtime.evaluate', {
    expression: 'window.devicePixelRatio',
    returnByValue: true,
  });
  const devicePixelRatio =
    (dprResponse.data?.result as { result?: { value?: number } })?.result?.value ?? 1;

  const metricsResponse = await callCDP('Page.getLayoutMetrics', {});
  const metricsResult = metricsResponse.data?.result as
    | Protocol.Page.GetLayoutMetricsResponse
    | undefined;

  const contentSize = metricsResult?.contentSize ?? { width: 0, height: 0 };
  const viewport = metricsResult?.visualViewport ?? { clientWidth: 0, clientHeight: 0 };

  const pageIsTooTall =
    !noResize && requestedFullPage && isTallPage(contentSize.width, contentSize.height);
  const useScroll = options.scroll !== undefined;
  const effectiveFullPage = useScroll ? false : pageIsTooTall ? false : requestedFullPage;

  const captureWidth = effectiveFullPage ? contentSize.width : viewport.clientWidth;
  const captureHeight = effectiveFullPage ? contentSize.height : viewport.clientHeight;

  const resized = shouldResize(captureWidth, captureHeight, noResize);
  const scale = resized ? calculateResizeScale(captureWidth, captureHeight) : 1;

  const screenshotResponse = await callCDP('Page.captureScreenshot', {
    format,
    ...(quality !== undefined && { quality }),
    captureBeyondViewport: effectiveFullPage,
    clip: {
      x: 0,
      y: 0,
      width: captureWidth,
      height: captureHeight,
      scale,
    },
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

  const finalCssWidth = Math.round(captureWidth * scale);
  const finalCssHeight = Math.round(captureHeight * scale);
  const actualWidth = Math.round(finalCssWidth * devicePixelRatio);
  const actualHeight = Math.round(finalCssHeight * devicePixelRatio);

  const result: ScreenshotResult = {
    path: absolutePath,
    format,
    width: actualWidth,
    height: actualHeight,
    size: buffer.length,
    fullPage: effectiveFullPage,
    captureMode: effectiveFullPage ? 'full_page' : 'viewport',
    finalTokens: calculateImageTokens(actualWidth, actualHeight),
  };

  if (quality !== undefined) {
    result.quality = quality;
  }

  if (!effectiveFullPage) {
    result.viewport = {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    };
  }

  if (resized) {
    const originalActualWidth = Math.round(captureWidth * devicePixelRatio);
    const originalActualHeight = Math.round(captureHeight * devicePixelRatio);
    result.resized = true;
    result.originalWidth = originalActualWidth;
    result.originalHeight = originalActualHeight;
    result.originalTokens = calculateImageTokens(originalActualWidth, originalActualHeight);
  }

  if (pageIsTooTall && !useScroll) {
    result.fullPageSkipped = {
      reason: 'page_too_tall',
      originalHeight: contentSize.height,
      aspectRatio: Math.round((contentSize.height / contentSize.width) * 10) / 10,
    };
  }

  if (useScroll && options.scroll) {
    result.scrolledTo = options.scroll;
  }

  return result;
}

/**
 * Get element bounding box via CDP DOM.getBoxModel.
 *
 * Extracts the content box coordinates from the box model quad array.
 * The content quad is an array of 8 numbers: [x1,y1, x2,y2, x3,y3, x4,y4]
 * representing the four corners of the content box.
 *
 * @param nodeId - CDP node ID
 * @returns Element bounds (x, y, width, height)
 * @throws CommandError if element not found or has zero dimensions
 */
export async function getElementBounds(nodeId: number): Promise<ElementBounds> {
  const response = await callCDP('DOM.getBoxModel', { nodeId });
  const boxModel = response.data?.result as Protocol.DOM.GetBoxModelResponse | undefined;

  if (!boxModel?.model?.content) {
    throw new CommandError(
      'Failed to get element bounds',
      { suggestion: 'Element may not be rendered or visible' },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }

  const content = boxModel.model.content;
  const x = content[0] ?? 0;
  const y = content[1] ?? 0;
  const width = (content[2] ?? 0) - x;
  const height = (content[5] ?? 0) - y;

  if (width <= 0 || height <= 0) {
    throw new CommandError(
      'Element has zero dimensions (not visible)',
      { suggestion: 'Element may be hidden or collapsed' },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }

  return { x, y, width, height };
}

/**
 * Resolve CSS selector to CDP nodeId.
 *
 * Queries the document for a single element matching the selector.
 *
 * @param selector - CSS selector string
 * @returns CDP nodeId
 * @throws CommandError if element not found
 */
export async function resolveSelector(selector: string): Promise<number> {
  await callCDP('DOM.enable', {});

  const docResponse = await callCDP('DOM.getDocument', {});
  const doc = docResponse.data?.result as Protocol.DOM.GetDocumentResponse | undefined;

  if (!doc?.root?.nodeId) {
    throw new CDPConnectionError('Failed to get document root', new Error('No root node'));
  }

  const queryResponse = await callCDP('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector,
  });
  const queryResult = queryResponse.data?.result as Protocol.DOM.QuerySelectorResponse | undefined;

  if (!queryResult?.nodeId) {
    throw new CommandError(
      `Element not found: "${selector}"`,
      { suggestion: "Run 'bdg dom query' to verify element exists" },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }

  return queryResult.nodeId;
}

/**
 * Capture screenshot of a specific element.
 *
 * Uses the element's bounding box to clip the screenshot region.
 * By default, auto-resizes images exceeding 1568px on longest edge to optimize
 * for Claude Vision token cost (~1,600 tokens max). Use noResize option to disable.
 *
 * @param outputPath - Output file path
 * @param nodeId - CDP node ID of element
 * @param options - Format, quality, and noResize options
 * @returns Screenshot result with element bounds and resize metadata
 */
export async function captureElementScreenshot(
  outputPath: string,
  nodeId: number,
  options: { format?: 'png' | 'jpeg'; quality?: number; noResize?: boolean } = {}
): Promise<ScreenshotResult> {
  const bounds = await getElementBounds(nodeId);

  const format = options.format ?? 'png';
  const quality = format === 'jpeg' ? (options.quality ?? 90) : undefined;
  const noResize = options.noResize ?? false;

  const dprResponse = await callCDP('Runtime.evaluate', {
    expression: 'window.devicePixelRatio',
    returnByValue: true,
  });
  const devicePixelRatio =
    (dprResponse.data?.result as { result?: { value?: number } })?.result?.value ?? 1;

  const originalWidth = bounds.width;
  const originalHeight = bounds.height;
  const resized = shouldResize(originalWidth, originalHeight, noResize);
  const scale = resized ? calculateResizeScale(originalWidth, originalHeight) : 1;

  const screenshotResponse = await callCDP('Page.captureScreenshot', {
    format,
    ...(quality !== undefined && { quality }),
    clip: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      scale,
    },
    captureBeyondViewport: true,
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

  const finalCssWidth = Math.round(originalWidth * scale);
  const finalCssHeight = Math.round(originalHeight * scale);
  const actualWidth = Math.round(finalCssWidth * devicePixelRatio);
  const actualHeight = Math.round(finalCssHeight * devicePixelRatio);

  const result: ScreenshotResult = {
    path: absolutePath,
    format,
    width: actualWidth,
    height: actualHeight,
    size: buffer.length,
    fullPage: false,
    finalTokens: calculateImageTokens(actualWidth, actualHeight),
  };

  if (quality !== undefined) {
    result.quality = quality;
  }

  if (resized) {
    const originalActualWidth = Math.round(originalWidth * devicePixelRatio);
    const originalActualHeight = Math.round(originalHeight * devicePixelRatio);
    result.resized = true;
    result.originalWidth = originalActualWidth;
    result.originalHeight = originalActualHeight;
    result.originalTokens = calculateImageTokens(originalActualWidth, originalActualHeight);
  }

  return result;
}
