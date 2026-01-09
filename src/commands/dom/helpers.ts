/**
 * DOM helpers using CDP relay pattern.
 *
 * All queries use Playwright-style selector support via JS evaluation.
 * Supports standard CSS selectors and Playwright pseudo-classes:
 * - `:has-text("text")` - Element contains text (case-insensitive)
 * - `:text("text")` - Smallest element with text
 * - `:text-is("text")` - Exact text match
 * - `:visible` - Element is visible
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
  elementNotVisibleError,
  elementZeroDimensionsError,
} from '@/ui/messages/errors.js';
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
 * JavaScript helper for Playwright-style selector support.
 * Injected into browser context for all DOM queries.
 */
const QUERY_ELEMENTS_JS = `
function __bdgQueryElements(selector) {
  // Quick check for Playwright pseudo-classes
  if (!/:(?:has-text|text-is|text|visible)\\s*(?:\\(|$)/.test(selector)) {
    return [...document.querySelectorAll(selector)];
  }

  // Parse out Playwright pseudo-classes
  const pseudoMatches = [];
  let cssSelector = selector;

  // Extract :has-text("...")
  cssSelector = cssSelector.replace(/:has-text\\((['"])(.*?)\\1\\)/g, (_, q, text) => {
    pseudoMatches.push({ type: 'has-text', arg: text });
    return '';
  });

  // Extract :text-is("...") - must come before :text
  cssSelector = cssSelector.replace(/:text-is\\((['"])(.*?)\\1\\)/g, (_, q, text) => {
    pseudoMatches.push({ type: 'text-is', arg: text });
    return '';
  });

  // Extract :text("...")
  cssSelector = cssSelector.replace(/:text\\((['"])(.*?)\\1\\)/g, (_, q, text) => {
    pseudoMatches.push({ type: 'text', arg: text });
    return '';
  });

  // Extract :visible
  cssSelector = cssSelector.replace(/:visible/g, () => {
    pseudoMatches.push({ type: 'visible' });
    return '';
  });

  // Clean up any trailing/multiple spaces
  cssSelector = cssSelector.replace(/\\s+/g, ' ').trim() || '*';

  // Query with CSS selector
  let elements = [...document.querySelectorAll(cssSelector)];

  // Apply filters for each pseudo-class
  for (const pseudo of pseudoMatches) {
    elements = elements.filter(el => {
      switch (pseudo.type) {
        case 'has-text': {
          const text = pseudo.arg.toLowerCase();
          return el.textContent?.toLowerCase().includes(text);
        }
        case 'text': {
          const text = pseudo.arg.toLowerCase();
          const elText = el.textContent?.replace(/\\s+/g, ' ').trim().toLowerCase() || '';
          if (!elText.includes(text)) return false;
          // Check no child has the complete match (we want the smallest container)
          for (const child of el.children) {
            const childText = child.textContent?.replace(/\\s+/g, ' ').trim().toLowerCase() || '';
            if (childText.includes(text)) return false;
          }
          return true;
        }
        case 'text-is': {
          return el.textContent?.replace(/\\s+/g, ' ').trim() === pseudo.arg;
        }
        case 'visible': {
          const style = window.getComputedStyle(el);
          if (style.display === 'none') return false;
          if (style.visibility === 'hidden') return false;
          if (style.opacity === '0') return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        }
        default:
          return true;
      }
    });
  }

  return elements;
}
`;

/**
 * Escape selector for safe inclusion in JavaScript string.
 */
function escapeSelector(selector: string): string {
  return selector.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

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
 * @param selector - CSS/Playwright selector of element to scroll to
 * @returns Original scroll position before scrolling
 * @throws CommandError if element not found
 */
async function scrollToElement(selector: string): Promise<ScrollPosition> {
  const escapedSelector = escapeSelector(selector);
  const result = await callCDP('Runtime.evaluate', {
    expression: `
      ${QUERY_ELEMENTS_JS}
      (() => {
        const elements = __bdgQueryElements('${escapedSelector}');
        if (elements.length === 0) return { found: false };
        const el = elements[0];
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
 * Query DOM elements by selector.
 *
 * Supports standard CSS selectors and Playwright-style pseudo-classes.
 *
 * @param selector - CSS/Playwright selector
 * @returns Query result with matched nodes
 */
export async function queryDOMElements(selector: string): Promise<DomQueryResult> {
  const escapedSelector = escapeSelector(selector);

  const result = await callCDP('Runtime.evaluate', {
    expression: `
      ${QUERY_ELEMENTS_JS}
      (() => {
        const elements = __bdgQueryElements('${escapedSelector}');
        return elements.map((el, index) => {
          const tag = el.tagName?.toLowerCase() || '';
          const classes = el.className?.split?.(/\\s+/).filter(c => c.length > 0) || [];
          const textContent = el.textContent?.replace(/<[^>]*>/g, '').replace(/\\s+/g, ' ').trim() || '';
          const preview = textContent.slice(0, 80) + (textContent.length > 80 ? '...' : '');
          return { index, tag, classes, preview };
        });
      })()
    `,
    returnByValue: true,
  });

  const nodes =
    (
      result.data?.result as {
        result?: {
          value?: Array<{ index: number; tag: string; classes: string[]; preview: string }>;
        };
      }
    )?.result?.value ?? [];

  if (nodes.length > 20) {
    log.debug(`Found ${nodes.length} elements for selector: ${selector}`);
  }

  return {
    selector,
    count: nodes.length,
    nodes,
  };
}

/**
 * Get full HTML and attributes for DOM elements.
 *
 * @param options - Get options (selector required)
 * @returns Get result with node details
 */
export async function getDOMElements(options: DomGetOptions): Promise<DomGetResult> {
  if (!options.selector) {
    throw new CommandError(
      'Selector is required',
      { suggestion: 'Use: bdg dom get <selector>' },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }

  const escapedSelector = escapeSelector(options.selector);

  const result = await callCDP('Runtime.evaluate', {
    expression: `
      ${QUERY_ELEMENTS_JS}
      (() => {
        const elements = __bdgQueryElements('${escapedSelector}');
        ${options.all ? '' : 'elements.splice(1);'} // Keep only first unless --all
        return elements.map(el => {
          const tag = el.tagName?.toLowerCase() || '';
          const attributes = {};
          for (const attr of el.attributes || []) {
            attributes[attr.name] = attr.value;
          }
          const classes = el.className?.split?.(/\\s+/).filter(c => c.length > 0) || [];
          return { tag, attributes, classes, outerHTML: el.outerHTML };
        });
      })()
    `,
    returnByValue: true,
  });

  const nodes =
    (
      result.data?.result as {
        result?: {
          value?: Array<{
            tag: string;
            attributes: Record<string, string>;
            classes: string[];
            outerHTML: string;
          }>;
        };
      }
    )?.result?.value ?? [];

  if (nodes.length === 0) {
    const err = noNodesFoundError(options.selector);
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }

  return { nodes };
}

/**
 * Fetch DOM context (tag, classes, text preview) for first matching element.
 *
 * @param selector - CSS/Playwright selector
 * @returns DOM context with tag, classes, and text preview
 */
export async function getDomContext(selector: string): Promise<DomContext | null> {
  try {
    const escapedSelector = escapeSelector(selector);

    const result = await callCDP('Runtime.evaluate', {
      expression: `
        ${QUERY_ELEMENTS_JS}
        (() => {
          const elements = __bdgQueryElements('${escapedSelector}');
          if (elements.length === 0) return null;
          const el = elements[0];
          const tag = el.tagName?.toLowerCase() || '';
          const classes = el.className?.split?.(/\\s+/).filter(c => c.length > 0) || [];
          const textContent = el.textContent?.replace(/\\s+/g, ' ').trim() || '';
          const preview = textContent.slice(0, 80) + (textContent.length > 80 ? '...' : '');
          return { tag, classes, preview };
        })()
      `,
      returnByValue: true,
    });

    const context = (
      result.data?.result as {
        result?: { value?: { tag: string; classes: string[]; preview: string } | null };
      }
    )?.result?.value;

    if (!context) return null;

    const domContext: DomContext = { tag: context.tag };
    if (context.classes.length > 0) domContext.classes = context.classes;
    if (context.preview) domContext.preview = context.preview;

    return domContext;
  } catch {
    return null;
  }
}

/**
 * Get element bounding box via JS getBoundingClientRect.
 *
 * @param selector - CSS/Playwright selector
 * @returns Element bounds (x, y, width, height) in document coordinates
 * @throws CommandError if element not found or has zero dimensions
 */
export async function getElementBounds(selector: string): Promise<ElementBounds> {
  const escapedSelector = escapeSelector(selector);

  const result = await callCDP('Runtime.evaluate', {
    expression: `
      ${QUERY_ELEMENTS_JS}
      (() => {
        const elements = __bdgQueryElements('${escapedSelector}');
        if (elements.length === 0) return { found: false };
        const el = elements[0];
        const rect = el.getBoundingClientRect();
        return {
          found: true,
          x: rect.left + window.scrollX,
          y: rect.top + window.scrollY,
          width: rect.width,
          height: rect.height
        };
      })()
    `,
    returnByValue: true,
  });

  const value = (
    result.data?.result as {
      result?: {
        value?: { found: boolean; x?: number; y?: number; width?: number; height?: number };
      };
    }
  )?.result?.value;

  if (!value?.found) {
    const err = elementNotVisibleError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.RESOURCE_NOT_FOUND
    );
  }

  const x = value.x ?? 0;
  const y = value.y ?? 0;
  const width = value.width ?? 0;
  const height = value.height ?? 0;

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
 * Capture a screenshot of the page using CDP relay.
 *
 * By default, auto-resizes images exceeding 1568px on longest edge to optimize
 * for Claude Vision token cost (~1,600 tokens max). Tall pages (aspect ratio greater than 3:1)
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
      const escapedSelector = escapeSelector(options.scroll);
      await callCDP('Runtime.evaluate', {
        expression: `
          ${QUERY_ELEMENTS_JS}
          (() => {
            const elements = __bdgQueryElements('${escapedSelector}');
            if (elements.length > 0) {
              elements[0].scrollIntoView({ block: 'center', behavior: 'instant' });
            }
          })()
        `,
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
 * Capture screenshot of a specific element.
 *
 * Uses the element's bounding box to clip the screenshot region.
 * By default, auto-resizes images exceeding 1568px on longest edge to optimize
 * for Claude Vision token cost (~1,600 tokens max). Use noResize option to disable.
 *
 * @param outputPath - Output file path
 * @param selector - CSS/Playwright selector for element
 * @param options - Format, quality, and noResize options
 * @returns Screenshot result with element bounds and resize metadata
 */
export async function captureElementScreenshot(
  outputPath: string,
  selector: string,
  options: { format?: 'png' | 'jpeg'; quality?: number; noResize?: boolean } = {}
): Promise<ScreenshotResult> {
  const bounds = await getElementBounds(selector);

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
