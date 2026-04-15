/**
 * CDP-relay helpers for screenshot capture.
 *
 * Covers page, element, and element-bounds operations plus the scroll-into-
 * view primitives used by page screenshots with `--scroll`.
 */

import {
  calculateImageTokens,
  calculateResizeScale,
  isTallPage,
  shouldResize,
} from '@/commands/dom/screenshotResize.js';
import { CDPConnectionError } from '@/connection/errors.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  noNodesFoundError,
  elementNotVisibleError,
  elementZeroDimensionsError,
} from '@/errors/messages.js';
import { callCDP } from '@/ipc/client.js';
import type { ScreenshotResult, ScreenshotOptions, ElementBounds } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('dom');

interface ScrollPosition {
  x: number;
  y: number;
}

const POST_SCROLL_NETWORK_IDLE_MS = 150;
const POST_SCROLL_DOM_STABLE_MS = 200;
const POST_SCROLL_MAX_WAIT_MS = 2000;
const STABILITY_CHECK_INTERVAL_MS = 50;

/**
 * Wait for the page to settle after a programmatic scroll (lazy-load idle +
 * DOM mutation idle). Uses shorter thresholds than full page load.
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
 * Scroll an element into view before capture; returns the original scroll
 * position so it can be restored afterwards.
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

async function restoreScrollPosition(position: ScrollPosition): Promise<void> {
  await callCDP('Runtime.evaluate', {
    expression: `window.scrollTo(${position.x}, ${position.y})`,
    returnByValue: true,
  });
}

/**
 * Get the bounding box of an element via CDP DOM.getBoxModel.
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
 * Capture a screenshot of the page. Auto-resizes oversized pages by default
 * to keep Claude Vision token cost bounded; falls back to viewport capture
 * when the page is taller than the tall-page threshold.
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

    if (options.scroll) {
      await callCDP('Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(options.scroll)})?.scrollIntoView({ block: 'center', behavior: 'instant' })`,
        returnByValue: true,
      });
    }
  }

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
 * Capture a screenshot of a single element, clipped to its bounding box.
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
