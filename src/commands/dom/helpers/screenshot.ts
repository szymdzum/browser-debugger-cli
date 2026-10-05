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
import { writeOutputFile } from '@/commands/shared/outputFile.js';
import { CDPConnectionError } from '@/connection/errors.js';
import type { Protocol } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  noNodesFoundError,
  elementNotVisibleError,
  elementZeroDimensionsError,
} from '@/errors/messages.js';
import { callCDP } from '@/ipc/client.js';
import { DEEP_QUERY_JS, selectorArgsJS } from '@/runtime/dom/targetNode.js';
import { viewportOverride } from '@/runtime/page/emulation.js';
import { readSessionMetadata } from '@/session/metadata.js';
import type { ScreenshotResult, ScreenshotOptions, ElementBounds, NodeRef } from '@/types.js';
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
        const el = (${DEEP_QUERY_JS})(${selectorArgsJS(selector)})[0];
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
 * Capture at a pixel ratio of 1 (CSS px = image px) on a high-DPI display:
 * the viewport is overridden at its size (the session's `--viewport`, else
 * the visible one) until the returned function puts back what was there
 * before, the session's viewport or none.
 *
 * @param devicePixelRatio - Page's pixel ratio
 * @param viewport - Visible viewport size
 * @returns Function restoring the device metrics
 */
async function useUnitPixelRatio(
  devicePixelRatio: number,
  viewport: { clientWidth: number; clientHeight: number }
): Promise<() => Promise<void>> {
  if (devicePixelRatio === 1) return () => Promise.resolve();
  const sessionViewport = readSessionMetadata()?.viewport;
  const size = sessionViewport ?? {
    width: Math.round(viewport.clientWidth),
    height: Math.round(viewport.clientHeight),
  };
  await callCDP('Emulation.setDeviceMetricsOverride', viewportOverride(size, 1));
  return async () => {
    if (sessionViewport) {
      await callCDP('Emulation.setDeviceMetricsOverride', viewportOverride(sessionViewport));
    } else {
      await callCDP('Emulation.clearDeviceMetricsOverride', {});
    }
  };
}

/**
 * Get the bounding box (border box, so padding and border are included) of an
 * element via CDP DOM.getBoxModel.
 *
 * @param ref - Node reference
 * @returns Element bounds in CSS pixels
 */
export async function getElementBounds(ref: NodeRef): Promise<ElementBounds> {
  const response = await callCDP('DOM.getBoxModel', ref);
  const boxModel = response.data?.result as Protocol.DOM.GetBoxModelResponse | undefined;

  if (!boxModel?.model?.border) {
    const err = elementNotVisibleError();
    throw new CommandError(
      err.message,
      { suggestion: err.suggestion },
      EXIT_CODES.INVALID_ARGUMENTS
    );
  }

  const border = boxModel.model.border;
  const x = border[0] ?? 0;
  const y = border[1] ?? 0;
  const width = (border[2] ?? 0) - x;
  const height = (border[5] ?? 0) - y;

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
    Protocol.Page.GetLayoutMetricsResponse | undefined;

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

  const restoreMetrics = await useUnitPixelRatio(devicePixelRatio, viewport);
  if (devicePixelRatio !== 1) {
    if (options.scroll) {
      await callCDP('Runtime.evaluate', {
        expression: `(${DEEP_QUERY_JS})(${selectorArgsJS(options.scroll)})[0]?.scrollIntoView({ block: 'center', behavior: 'instant' })`,
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
      Protocol.Page.CaptureScreenshotResponse | undefined;
  } finally {
    await restoreMetrics();
  }

  if (!screenshotResult?.data) {
    throw new CDPConnectionError('No screenshot data returned', new Error('Empty response'));
  }

  const buffer = Buffer.from(screenshotResult.data, 'base64');
  const absolutePath = await writeOutputFile(outputPath, buffer);

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

/** Descendants {@link CONTENT_OVERFLOW_JS} looks at, so a huge element stays cheap */
const OVERFLOW_SCAN_LIMIT = 2000;

/**
 * Page-side distances (CSS px, never negative) by which an element's rendered
 * descendants reach beyond its border box on each side: uncleared floats,
 * absolutely positioned and transformed children. Descendants of an element
 * that clips its overflow (`overflow` other than `visible`) are cut off by it
 * and not counted, nor are fixed ones (they belong to the viewport) or what
 * lies outside the document (skip links at -9999px). Zero everywhere when the
 * element clips its own overflow.
 */
const CONTENT_OVERFLOW_JS = `function () {
  const view = this.ownerDocument.defaultView;
  const scroller = this.ownerDocument.scrollingElement || this.ownerDocument.documentElement;
  const own = this.getBoundingClientRect();
  const reach = { left: own.left, top: own.top, right: own.right, bottom: own.bottom };
  const page = { left: -view.scrollX, top: -view.scrollY, right: scroller.scrollWidth - view.scrollX, bottom: scroller.scrollHeight - view.scrollY };
  const clips = (style) => style.overflowX !== 'visible' || style.overflowY !== 'visible';
  let budget = ${OVERFLOW_SCAN_LIMIT};
  const walk = (el) => {
    for (const child of el.children) {
      if (--budget < 0) return;
      const style = view.getComputedStyle(child);
      if (style.display === 'none' || style.position === 'fixed') continue;
      const r = child.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && style.visibility === 'visible') {
        reach.left = Math.min(reach.left, Math.max(r.left, page.left));
        reach.top = Math.min(reach.top, Math.max(r.top, page.top));
        reach.right = Math.max(reach.right, Math.min(r.right, page.right));
        reach.bottom = Math.max(reach.bottom, Math.min(r.bottom, page.bottom));
      }
      if (!clips(style)) walk(child);
    }
  };
  if (!clips(view.getComputedStyle(this))) walk(this);
  return { left: own.left - reach.left, top: own.top - reach.top, right: reach.right - own.right, bottom: reach.bottom - own.bottom };
}`;

/** Overflow (px) below which the capture keeps to the border box (subpixel rounding) */
const OVERFLOW_SLACK = 1;

/**
 * Area an element screenshot captures: the border box, grown to the content
 * that overflows it ({@link CONTENT_OVERFLOW_JS}), so floated children are
 * not cropped away.
 *
 * @param ref - Node reference
 * @param bounds - Border box (DOM.getBoxModel coordinates)
 * @returns The area, or the border box when nothing overflows (or the page cannot be asked)
 */
async function captureArea(ref: NodeRef, bounds: ElementBounds): Promise<ElementBounds> {
  const objectGroup = `bdg-shot-${process.pid}`;
  try {
    const resolved = await callCDP('DOM.resolveNode', { ...ref, objectGroup });
    const objectId = (resolved.data?.result as Protocol.DOM.ResolveNodeResponse | undefined)?.object
      .objectId;
    if (!objectId) return bounds;
    const response = await callCDP('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: CONTENT_OVERFLOW_JS,
      returnByValue: true,
    });
    const overflow = (response.data?.result as { result?: { value?: Record<string, number> } })
      ?.result?.value;
    if (!overflow) return bounds;
    const [left, top, right, bottom] = ['left', 'top', 'right', 'bottom'].map((side) =>
      Math.max(0, overflow[side] ?? 0)
    ) as [number, number, number, number];
    if (Math.max(left, top, right, bottom) <= OVERFLOW_SLACK) return bounds;
    return {
      x: bounds.x - left,
      y: bounds.y - top,
      width: bounds.width + left + right,
      height: bounds.height + top + bottom,
    };
  } catch (error) {
    log.debug(`Could not measure overflowing content: ${String(error)}`);
    return bounds;
  } finally {
    await callCDP('Runtime.releaseObjectGroup', { objectGroup }).catch(() => undefined);
  }
}

/**
 * Capture a screenshot of a single element: its border box, grown to include
 * content overflowing it ({@link captureArea}). The box model is relative to
 * the viewport and the capture clip to the page, so the page scroll is added
 * (the reported bounds are page coordinates, like `dom layout`'s).
 */
export async function captureElementScreenshot(
  outputPath: string,
  ref: NodeRef,
  options: { format?: 'png' | 'jpeg'; quality?: number; noResize?: boolean } = {}
): Promise<ScreenshotResult> {
  const box = await getElementBounds(ref);
  const bounds = await captureArea(ref, box);

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
    Protocol.Page.GetLayoutMetricsResponse | undefined;
  const viewport = metricsResult?.visualViewport ?? { clientWidth: 800, clientHeight: 600 };
  const scroll = metricsResult?.cssLayoutViewport ?? { pageX: 0, pageY: 0 };
  const onPage = (area: ElementBounds): ElementBounds => ({
    ...area,
    x: area.x + scroll.pageX,
    y: area.y + scroll.pageY,
  });
  const clip = onPage(bounds);

  const restoreMetrics = await useUnitPixelRatio(devicePixelRatio, viewport);

  let screenshotResult: Protocol.Page.CaptureScreenshotResponse | undefined;
  try {
    const screenshotResponse = await callCDP('Page.captureScreenshot', {
      format,
      ...(quality !== undefined && { quality }),
      clip: { ...clip, scale },
      captureBeyondViewport: true,
    });
    screenshotResult = screenshotResponse.data?.result as
      Protocol.Page.CaptureScreenshotResponse | undefined;
  } finally {
    await restoreMetrics();
  }

  if (!screenshotResult?.data) {
    throw new CDPConnectionError('No screenshot data returned', new Error('Empty response'));
  }

  const buffer = Buffer.from(screenshotResult.data, 'base64');
  const absolutePath = await writeOutputFile(outputPath, buffer);

  const result: ScreenshotResult = {
    path: absolutePath,
    format,
    width: finalWidth,
    height: finalHeight,
    size: buffer.length,
    fullPage: false,
    finalTokens: calculateImageTokens(finalWidth, finalHeight),
    element: {
      bounds: roundBounds(onPage(box)),
      ...(bounds !== box && { captured: roundBounds(clip) }),
    },
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

/**
 * Bounds in whole pixels.
 *
 * @param bounds - Bounds
 * @returns Rounded bounds
 */
function roundBounds(bounds: ElementBounds): ElementBounds {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height),
  };
}
