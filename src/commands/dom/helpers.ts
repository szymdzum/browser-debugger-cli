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
import {
  noNodesFoundError,
  indexOutOfRangeError,
  elementNotVisibleError,
  elementZeroDimensionsError,
  eitherArgumentRequiredError,
} from '@/ui/messages/errors.js';
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
 * Scroll position before a scroll operation.
 */
interface ScrollPosition {
  x: number;
  y: number;
}

/** Network idle threshold after scroll (shorter than page load) */
const POST_SCROLL_NETWORK_IDLE_MS = 150;
/** DOM stable threshold after scroll (shorter than page load) */
const POST_SCROLL_DOM_STABLE_MS = 200;
/** Maximum wait for post-scroll stability */
const POST_SCROLL_MAX_WAIT_MS = 2000;
/** Check interval for stability polling */
const STABILITY_CHECK_INTERVAL_MS = 50;

/**
 * Wait for page to stabilize after scrolling.
 *
 * Detects lazy-loaded content and DOM mutations triggered by scroll.
 * Uses shorter thresholds than full page load since we're only waiting
 * for scroll-triggered content, not initial page load.
 *
 * @returns Promise that resolves when page is stable or timeout reached
 */
async function waitForPostScrollStability(): Promise<void> {
  const deadline = Date.now() + POST_SCROLL_MAX_WAIT_MS;

  await callCDP('Runtime.evaluate', {
    expression: `
      (() => {
        window.__bdg_scrollStability = {
          lastNetworkActivity: Date.now(),
          lastDomMutation: Date.now(),
          activeRequests: 0
        };

        const state = window.__bdg_scrollStability;

        // Track network activity via Performance Observer
        if (window.PerformanceObserver) {
          const perfObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (entry.entryType === 'resource') {
                state.lastNetworkActivity = Date.now();
              }
            }
          });
          try {
            perfObserver.observe({ entryTypes: ['resource'] });
            state.perfObserver = perfObserver;
          } catch (e) {}
        }

        // Track DOM mutations
        const mutationObserver = new MutationObserver(() => {
          state.lastDomMutation = Date.now();
        });
        mutationObserver.observe(document.body || document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true
        });
        state.mutationObserver = mutationObserver;
      })()
    `,
    returnByValue: true,
  });

  try {
    while (Date.now() < deadline) {
      const checkResult = await callCDP('Runtime.evaluate', {
        expression: `
          (() => {
            const state = window.__bdg_scrollStability;
            if (!state) return { networkIdle: 999, domIdle: 999 };
            return {
              networkIdle: Date.now() - state.lastNetworkActivity,
              domIdle: Date.now() - state.lastDomMutation
            };
          })()
        `,
        returnByValue: true,
      });

      const value = (
        checkResult.data?.result as {
          result?: { value?: { networkIdle?: number; domIdle?: number } };
        }
      )?.result?.value;
      const networkIdle = value?.networkIdle ?? 0;
      const domIdle = value?.domIdle ?? 0;

      if (networkIdle >= POST_SCROLL_NETWORK_IDLE_MS && domIdle >= POST_SCROLL_DOM_STABLE_MS) {
        log.debug(`Post-scroll stable: network ${networkIdle}ms, DOM ${domIdle}ms`);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, STABILITY_CHECK_INTERVAL_MS));
    }

    log.debug('Post-scroll stability timeout, proceeding anyway');
  } finally {
    await callCDP('Runtime.evaluate', {
      expression: `
        (() => {
          const state = window.__bdg_scrollStability;
          if (state) {
            state.perfObserver?.disconnect();
            state.mutationObserver?.disconnect();
            delete window.__bdg_scrollStability;
          }
        })()
      `,
      returnByValue: true,
    });
  }
}

/**
 * Scroll an element into view before capture.
 *
 * Returns the original scroll position so it can be restored after capture.
 * Waits for lazy-loaded content and DOM mutations to stabilize before returning.
 *
 * @param selector - CSS selector of element to scroll to
 * @returns Original scroll position before scrolling
 * @throws CommandError if element not found
 */
async function scrollToElement(selector: string): Promise<ScrollPosition> {
  const result = await callCDP('Runtime.evaluate', {
    expression: `
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return { found: false };
        const originalX = window.scrollX;
        const originalY = window.scrollY;
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        return { found: true, originalX, originalY };
      })()
    `,
    returnByValue: true,
  });

  const value = (
    result.data?.result as {
      result?: { value?: { found?: boolean; originalX?: number; originalY?: number } };
    }
  )?.result?.value;
  if (!value?.found) {
    const err = noNodesFoundError(selector);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }

  await waitForPostScrollStability();

  return { x: value.originalX ?? 0, y: value.originalY ?? 0 };
}

/**
 * Restore scroll position after capture.
 *
 * @param position - Scroll position to restore
 */
async function restoreScrollPosition(position: ScrollPosition): Promise<void> {
  await callCDP('Runtime.evaluate', {
    expression: `window.scrollTo(${position.x}, ${position.y})`,
    returnByValue: true,
  });
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

  let originalScrollPosition: ScrollPosition | undefined;
  if (options.scroll) {
    originalScrollPosition = await scrollToElement(options.scroll);
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

  const finalWidth = Math.round(captureWidth * scale);
  const finalHeight = Math.round(captureHeight * scale);

  if (devicePixelRatio !== 1) {
    await callCDP('Emulation.setDeviceMetricsOverride', {
      width: Math.round(viewport.clientWidth),
      height: Math.round(viewport.clientHeight),
      deviceScaleFactor: 1,
      mobile: false,
    });

    // Re-scroll after DPR override (setDeviceMetricsOverride resets scroll position)
    if (options.scroll) {
      await callCDP('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(options.scroll)})?.scrollIntoView({ block: 'center', behavior: 'instant' })`,
        returnByValue: true,
      });
    }
  }

  // Get scroll position for clip coordinates (clip uses document coordinates, not viewport)
  let clipX = 0;
  let clipY = 0;
  if (useScroll && !effectiveFullPage) {
    const scrollResponse = await callCDP('Runtime.evaluate', {
      expression: 'JSON.stringify({ x: window.scrollX, y: window.scrollY })',
      returnByValue: true,
    });
    const scrollPos = JSON.parse(
      (scrollResponse.data?.result as { result?: { value?: string } })?.result?.value ??
        '{"x":0,"y":0}'
    ) as { x: number; y: number };
    clipX = scrollPos.x;
    clipY = scrollPos.y;
  }

  let screenshotResult: Protocol.Page.CaptureScreenshotResponse | undefined;
  try {
    const screenshotResponse = await callCDP('Page.captureScreenshot', {
      format,
      ...(quality !== undefined && { quality }),
      captureBeyondViewport: effectiveFullPage,
      clip: {
        x: clipX,
        y: clipY,
        width: captureWidth,
        height: captureHeight,
        scale,
      },
    });
    screenshotResult = screenshotResponse.data?.result as
      | Protocol.Page.CaptureScreenshotResponse
      | undefined;
  } finally {
    if (devicePixelRatio !== 1) {
      await callCDP('Emulation.clearDeviceMetricsOverride', {});
    }
  }

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
    width: finalWidth,
    height: finalHeight,
    size: buffer.length,
    fullPage: effectiveFullPage,
    captureMode: effectiveFullPage ? 'full_page' : 'viewport',
    finalTokens: calculateImageTokens(finalWidth, finalHeight),
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
    result.resized = true;
    result.originalWidth = captureWidth;
    result.originalHeight = captureHeight;
    result.originalTokens = calculateImageTokens(captureWidth, captureHeight);
  }

  if (pageIsTooTall && !useScroll) {
    const aspectRatio = Math.round((contentSize.height / contentSize.width) * 10) / 10;
    result.fullPageSkipped = {
      reason: 'page_too_tall',
      originalHeight: contentSize.height,
      aspectRatio,
    };
    result.warning = `Full page capture skipped: page too tall (${aspectRatio}:1 aspect ratio). Only viewport captured.`;
  }

  if (useScroll && options.scroll) {
    result.scrolledTo = options.scroll;
  }

  if (originalScrollPosition) {
    await restoreScrollPosition(originalScrollPosition);
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
    const err = elementNotVisibleError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }

  const content = boxModel.model.content;
  const x = content[0] ?? 0;
  const y = content[1] ?? 0;
  const width = (content[2] ?? 0) - x;
  const height = (content[5] ?? 0) - y;

  if (width <= 0 || height <= 0) {
    const err = elementZeroDimensionsError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
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
    const err = noNodesFoundError(selector);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
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

  const finalWidth = Math.round(originalWidth * scale);
  const finalHeight = Math.round(originalHeight * scale);

  const metricsResponse = await callCDP('Page.getLayoutMetrics', {});
  const metricsResult = metricsResponse.data?.result as
    | Protocol.Page.GetLayoutMetricsResponse
    | undefined;
  const viewport = metricsResult?.visualViewport ?? { clientWidth: 800, clientHeight: 600 };

  if (devicePixelRatio !== 1) {
    await callCDP('Emulation.setDeviceMetricsOverride', {
      width: Math.round(viewport.clientWidth),
      height: Math.round(viewport.clientHeight),
      deviceScaleFactor: 1,
      mobile: false,
    });
  }

  let screenshotResult: Protocol.Page.CaptureScreenshotResponse | undefined;
  try {
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
    screenshotResult = screenshotResponse.data?.result as
      | Protocol.Page.CaptureScreenshotResponse
      | undefined;
  } finally {
    if (devicePixelRatio !== 1) {
      await callCDP('Emulation.clearDeviceMetricsOverride', {});
    }
  }

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
    width: finalWidth,
    height: finalHeight,
    size: buffer.length,
    fullPage: false,
    finalTokens: calculateImageTokens(finalWidth, finalHeight),
  };

  if (quality !== undefined) {
    result.quality = quality;
  }

  if (resized) {
    result.resized = true;
    result.originalWidth = originalWidth;
    result.originalHeight = originalHeight;
    result.originalTokens = calculateImageTokens(originalWidth, originalHeight);
  }

  return result;
}
