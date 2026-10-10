/**
 * Screenshots of the page or one element (`bdg dom screenshot`), taken in the
 * daemon: measuring, the emulation changes the capture needs, the capture and
 * putting the emulation back all happen here, inside one `try`/`finally`, so
 * a CLI interrupted mid-capture (Ctrl-C) cannot leave the page changed. The
 * CLI only writes the returned image.
 *
 * The image travels base64-encoded in one IPC line: Chrome sends it the same
 * way over its WebSocket (100 MiB at most), well below the IPC line limit
 * (`MAX_JSONL_BUFFER_SIZE`).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { TypedCDPConnection, type Protocol } from '@/connection/typed-cdp.js';
import type { DomScreenshotCommand, DomScreenshotData } from '@/ipc/protocol/commands.js';
import { captureArea, getElementBounds, type ElementRef } from '@/runtime/dom/captureArea.js';
import { withBusyPageRecovery, type BusyRecoveryOptions } from '@/runtime/dom/evalHelpers.js';
import {
  CaptureEmulation,
  evaluateValue,
  scrollPosition,
  type ScrollPosition,
  type Size,
} from '@/runtime/page/captureEmulation.js';
import { scrollIntoViewAgain, scrollToElement } from '@/runtime/page/captureScroll.js';
import {
  calculateImageTokens,
  calculateResizeScale,
  isTallPage,
  shouldResize,
} from '@/runtime/page/screenshotResize.js';
import type { ElementBounds, ScreenshotResult, ViewportSize } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** What a screenshot reports, but the file it was written to */
type Screenshot = DomScreenshotData['screenshot'];

/** How a screenshot is run */
export interface ScreenshotOptions {
  /** Aborted when the requesting client disconnects: the capture is skipped, the restore runs */
  abandoned?: AbortSignal | undefined;
  /** When a busy page is checked */
  recovery?: BusyRecoveryOptions;
}

/** JPEG quality when none is given */
const DEFAULT_JPEG_QUALITY = 90;

/**
 * Take a screenshot: of the element `backendNodeId` names, else of the page.
 * Whatever emulation the capture changed is put back before this returns or
 * throws, from the session's record of its emulation at that time.
 *
 * A page whose scripts keep it busy gets them terminated
 * ({@link withBusyPageRecovery}, exit 102); the capture then ends, and the
 * error is reported once its emulation is back, so the next command does not
 * race the restore. A capture whose client left (Ctrl-C) is not taken once
 * that is known: only the restore runs.
 *
 * @param cdp - Session connection
 * @param params - What to capture and how
 * @param sessionViewport - Reads the session's emulated viewport, if any
 * @param options - When the client left, and when a busy page is checked (tests shorten it)
 * @returns The image (base64) and what was captured
 */
export async function takeScreenshot(
  cdp: CDPConnection,
  params: DomScreenshotCommand,
  sessionViewport: () => ViewportSize | undefined,
  options: ScreenshotOptions = {}
): Promise<DomScreenshotData> {
  const { abandoned, recovery = {} } = options;
  const emulation = new CaptureEmulation(cdp, sessionViewport);
  const shot = captureAndRestore(cdp, params, emulation, abandoned);
  try {
    return await withBusyPageRecovery(cdp, shot, recovery);
  } catch (error) {
    await shot.catch((captureError: unknown) =>
      log.debug(`Capture ended after the busy page: ${getErrorMessage(captureError)}`)
    );
    throw error;
  }
}

/**
 * Capture, then put back the emulation the capture changed. A failed restore
 * is reported only when the capture worked; otherwise the capture's error is.
 *
 * @param cdp - Session connection
 * @param params - What to capture and how
 * @param emulation - Emulation changes of this capture
 * @param abandoned - Aborted when the client left
 * @returns The image (base64) and what was captured
 */
async function captureAndRestore(
  cdp: CDPConnection,
  params: DomScreenshotCommand,
  emulation: CaptureEmulation,
  abandoned: AbortSignal | undefined
): Promise<DomScreenshotData> {
  let shot: DomScreenshotData;
  try {
    shot =
      params.backendNodeId === undefined
        ? await capturePage(cdp, params, emulation, abandoned)
        : await captureElement(
            cdp,
            { backendNodeId: params.backendNodeId },
            params,
            emulation,
            abandoned
          );
  } catch (error) {
    await emulation
      .restore()
      .catch((restoreError: unknown) =>
        log.debug(`Restore after a failed capture: ${getErrorMessage(restoreError)}`)
      );
    throw error;
  }
  await emulation.restore();
  return shot;
}

/**
 * JPEG quality of a capture (none for PNG).
 *
 * @param params - Format and requested quality
 * @returns Quality, or undefined for PNG
 */
function jpegQuality(params: DomScreenshotCommand): number | undefined {
  return params.format === 'jpeg' ? (params.quality ?? DEFAULT_JPEG_QUALITY) : undefined;
}

/**
 * The page's pixel ratio.
 *
 * @param cdp - Session connection
 * @returns `devicePixelRatio`, 1 when the page does not answer
 */
async function pixelRatio(cdp: CDPConnection): Promise<number> {
  const value = await evaluateValue(cdp, 'window.devicePixelRatio');
  return typeof value === 'number' ? value : 1;
}

/**
 * The page's layout metrics.
 *
 * @param cdp - Session connection
 * @returns `Page.getLayoutMetrics` result
 */
function layoutMetrics(cdp: CDPConnection): Promise<Protocol.Page.GetLayoutMetricsResponse> {
  return new TypedCDPConnection(cdp).send('Page.getLayoutMetrics', {});
}

/**
 * Capture an image, unless the client left: a capture of a tall page takes
 * seconds, and nobody would get it.
 *
 * @param cdp - Session connection
 * @param params - Format, quality, clip
 * @param abandoned - Aborted when the client left
 * @returns The image (base64) and its size in bytes
 * @throws The abort reason when the client left
 */
async function captureImage(
  cdp: CDPConnection,
  params: Protocol.Page.CaptureScreenshotRequest,
  abandoned: AbortSignal | undefined
): Promise<{ image: string; size: number }> {
  abandoned?.throwIfAborted();
  const { data } = await new TypedCDPConnection(cdp).send('Page.captureScreenshot', params);
  return { image: data, size: Buffer.byteLength(data, 'base64') };
}

/** How a page capture is taken */
interface PagePlan {
  fullPage: boolean;
  width: number;
  height: number;
  scale: number;
  resized: boolean;
  pageIsTooTall: boolean;
}

/**
 * Decide what a page capture covers: the whole page unless it is too tall
 * (then the viewport), the viewport with `--no-full-page` or `--scroll`;
 * scaled down to the token budget unless `--no-resize`.
 *
 * @param params - Capture options
 * @param contentSize - Page size
 * @param viewport - Viewport size
 * @returns The plan
 */
function planPageCapture(
  params: DomScreenshotCommand,
  contentSize: Size,
  viewport: Size
): PagePlan {
  const noResize = params.noResize ?? false;
  const requestedFullPage = params.fullPage ?? true;
  const pageIsTooTall =
    !noResize && requestedFullPage && isTallPage(contentSize.width, contentSize.height);
  const fullPage = params.scroll === undefined && !pageIsTooTall && requestedFullPage;
  const { width, height } = fullPage ? contentSize : viewport;
  const resized = shouldResize(width, height, noResize);
  const scale = resized ? calculateResizeScale(width, height) : 1;
  return { fullPage, width, height, scale, resized, pageIsTooTall };
}

/**
 * Page coordinates of the visible area's top-left corner. A capture clip is
 * in page coordinates, so a viewport capture must start at the scroll
 * position, not at the page origin (which shows nothing once scrolled). Read
 * after any metrics override, which can move the scroll position.
 *
 * @param cdp - Session connection
 * @returns Scroll offset of the visual viewport in CSS pixels
 */
async function visibleAreaOrigin(cdp: CDPConnection): Promise<ScrollPosition> {
  const { cssVisualViewport } = await layoutMetrics(cdp);
  return { x: cssVisualViewport.pageX, y: cssVisualViewport.pageY };
}

/**
 * Capture the page. Auto-resizes oversized pages by default to keep Claude
 * Vision token cost bounded; falls back to viewport capture when the page is
 * taller than the tall-page threshold.
 *
 * @param cdp - Session connection
 * @param params - Capture options
 * @param emulation - Emulation changes of this capture
 * @param abandoned - Aborted when the client left
 * @returns Image and what was captured
 */
async function capturePage(
  cdp: CDPConnection,
  params: DomScreenshotCommand,
  emulation: CaptureEmulation,
  abandoned: AbortSignal | undefined
): Promise<DomScreenshotData> {
  if (params.scroll) emulation.scrolledAwayFrom(await scrollToElement(cdp, params.scroll));
  const devicePixelRatio = await pixelRatio(cdp);
  const { contentSize, visualViewport } = await layoutMetrics(cdp);
  const viewport = { width: visualViewport.clientWidth, height: visualViewport.clientHeight };
  const plan = planPageCapture(params, contentSize, viewport);
  await emulation.useUnitPixelRatio(devicePixelRatio, viewport);
  if (devicePixelRatio !== 1 && params.scroll) await scrollIntoViewAgain(cdp, params.scroll);
  const origin = plan.fullPage ? { x: 0, y: 0 } : await visibleAreaOrigin(cdp);
  if (plan.fullPage) emulation.capturesBeyondViewport(viewport);
  const quality = jpegQuality(params);
  const { image, size } = await captureImage(
    cdp,
    {
      format: params.format,
      ...(quality !== undefined && { quality }),
      captureBeyondViewport: plan.fullPage,
      clip: { ...origin, width: plan.width, height: plan.height, scale: plan.scale },
    },
    abandoned
  );
  const screenshot = pageScreenshot(params, plan, size, viewport, contentSize);
  return { image, screenshot };
}

/**
 * What a page capture reports.
 *
 * @param params - Capture options
 * @param plan - How it was taken
 * @param size - Image size in bytes
 * @param viewport - Viewport size
 * @param contentSize - Page size
 * @returns The report
 */
function pageScreenshot(
  params: DomScreenshotCommand,
  plan: PagePlan,
  size: number,
  viewport: Size,
  contentSize: Size
): Screenshot {
  const width = Math.round(plan.width * plan.scale);
  const height = Math.round(plan.height * plan.scale);
  const quality = jpegQuality(params);
  return {
    format: params.format,
    width,
    height,
    size,
    fullPage: plan.fullPage,
    captureMode: plan.fullPage ? 'full_page' : 'viewport',
    finalTokens: calculateImageTokens(width, height),
    ...(quality !== undefined && { quality }),
    ...(!plan.fullPage && { viewport }),
    ...resizeReport(plan.resized, plan.width, plan.height),
    ...(plan.pageIsTooTall && params.scroll === undefined && tallPageReport(contentSize)),
    ...(params.scroll !== undefined && { scrolledTo: params.scroll }),
  };
}

/**
 * Report of an auto-resize: the size before it.
 *
 * @param resized - Whether the image was scaled down
 * @param width - Width before (CSS px)
 * @param height - Height before (CSS px)
 * @returns Fields to add, none when not resized
 */
function resizeReport(
  resized: boolean,
  width: number,
  height: number
): Pick<ScreenshotResult, 'resized' | 'originalWidth' | 'originalHeight' | 'originalTokens'> {
  if (!resized) return {};
  return {
    resized: true,
    originalWidth: width,
    originalHeight: height,
    originalTokens: calculateImageTokens(width, height),
  };
}

/**
 * Report of a full-page capture skipped for a page too tall to read.
 *
 * @param contentSize - Page size
 * @returns `fullPageSkipped` and a warning
 */
function tallPageReport(contentSize: Size): Pick<ScreenshotResult, 'fullPageSkipped' | 'warning'> {
  const aspectRatio = Math.round((contentSize.height / contentSize.width) * 10) / 10;
  return {
    fullPageSkipped: {
      reason: 'page_too_tall',
      originalHeight: contentSize.height,
      aspectRatio,
    },
    warning: `Full page capture skipped: page too tall (${aspectRatio}:1 aspect ratio). Only viewport captured.`,
  };
}

/**
 * Whether an area (viewport coordinates) lies inside the viewport.
 *
 * @param area - Area
 * @param view - Viewport size
 * @returns True when fully inside
 */
function insideView(area: ElementBounds, view: Size): boolean {
  return (
    area.x >= 0 &&
    area.y >= 0 &&
    area.x + area.width <= view.width &&
    area.y + area.height <= view.height
  );
}

/** An element measured for its capture */
interface MeasuredElement {
  /** Border box (viewport coordinates) */
  box: ElementBounds;
  /** Area to capture (viewport coordinates) */
  bounds: ElementBounds;
  /** Whether the area is inside the viewport */
  inView: boolean;
}

/**
 * Measure the area to capture and, when it fits in the viewport but is not
 * in view, scroll it to the middle first (put back by the emulation's
 * restore). A capture inside the viewport keeps the page as it is; one
 * beyond it makes Chrome lay the page out without its scrollbar, so for an
 * area larger than the viewport the scrollbars are hidden first and the
 * area measured in that layout (centered content would else move by half
 * the scrollbar's width).
 *
 * @param cdp - Session connection
 * @param ref - The element
 * @param padding - Extra space around the area (CSS px)
 * @param emulation - Emulation changes of this capture
 * @returns The measurements
 */
async function measureInView(
  cdp: CDPConnection,
  ref: ElementRef,
  padding: number,
  emulation: CaptureEmulation
): Promise<MeasuredElement> {
  const { cssVisualViewport } = await layoutMetrics(cdp);
  const view = { width: cssVisualViewport.clientWidth, height: cssVisualViewport.clientHeight };
  const first = await measureArea(cdp, ref, padding);
  const { bounds } = first;
  if (bounds.width > view.width || bounds.height > view.height) {
    await emulation.keepLayoutWithoutScrollbars(view);
    return { ...(await measureArea(cdp, ref, padding)), inView: false };
  }
  if (insideView(bounds, view)) return { ...first, inView: true };
  emulation.scrolledAwayFrom(await scrollPosition(cdp));
  const dx = bounds.x + bounds.width / 2 - view.width / 2;
  const dy = bounds.y + bounds.height / 2 - view.height / 2;
  await evaluateValue(cdp, `window.scrollBy(${dx}, ${dy})`);
  const moved = await measureArea(cdp, ref, padding);
  return { ...moved, inView: insideView(moved.bounds, view) };
}

/**
 * Measure an element's border box and the area to capture.
 *
 * @param cdp - Session connection
 * @param ref - The element
 * @param padding - Extra space around the area (CSS px)
 * @returns Border box and area (viewport coordinates)
 */
async function measureArea(
  cdp: CDPConnection,
  ref: ElementRef,
  padding: number
): Promise<{ box: ElementBounds; bounds: ElementBounds }> {
  const box = await getElementBounds(cdp, ref);
  return { box, bounds: await captureArea(cdp, ref, box, padding) };
}

/**
 * Capture a single element: its border box, grown to include content
 * overflowing it ({@link captureArea}). The box model is relative to the
 * viewport and the capture clip to the page, so the page scroll is added
 * (the reported bounds are page coordinates, like `dom layout`'s).
 *
 * @param cdp - Session connection
 * @param ref - The element
 * @param params - Capture options
 * @param emulation - Emulation changes of this capture
 * @param abandoned - Aborted when the client left
 * @returns Image and what was captured
 */
async function captureElement(
  cdp: CDPConnection,
  ref: ElementRef,
  params: DomScreenshotCommand,
  emulation: CaptureEmulation,
  abandoned: AbortSignal | undefined
): Promise<DomScreenshotData> {
  const devicePixelRatio = await pixelRatio(cdp);
  const { visualViewport } = await layoutMetrics(cdp);
  const view = { width: visualViewport.clientWidth, height: visualViewport.clientHeight };
  await emulation.useUnitPixelRatio(devicePixelRatio, view);
  const measured = await measureInView(cdp, ref, params.padding ?? 0, emulation);
  if (!measured.inView) emulation.capturesBeyondViewport(view);
  const { cssLayoutViewport } = await layoutMetrics(cdp);
  const onPage = (area: ElementBounds): ElementBounds => ({
    ...area,
    x: area.x + cssLayoutViewport.pageX,
    y: area.y + cssLayoutViewport.pageY,
  });
  const clip = onPage(measured.bounds);
  const resized = shouldResize(clip.width, clip.height, params.noResize ?? false);
  const scale = resized ? calculateResizeScale(clip.width, clip.height) : 1;
  const quality = jpegQuality(params);
  const { image, size } = await captureImage(
    cdp,
    {
      format: params.format,
      ...(quality !== undefined && { quality }),
      clip: { ...clip, scale },
      captureBeyondViewport: !measured.inView,
    },
    abandoned
  );
  const element = {
    bounds: roundBounds(onPage(measured.box)),
    ...(measured.bounds !== measured.box && { captured: roundBounds(clip) }),
    ...(params.padding && { padding: params.padding }),
  };
  return { image, screenshot: elementScreenshot(params, clip, scale, size, element) };
}

/**
 * What an element capture reports.
 *
 * @param params - Capture options
 * @param clip - Area captured (CSS px)
 * @param scale - Resize scale
 * @param size - Image size in bytes
 * @param element - Element bounds as reported
 * @returns The report
 */
function elementScreenshot(
  params: DomScreenshotCommand,
  clip: ElementBounds,
  scale: number,
  size: number,
  element: NonNullable<ScreenshotResult['element']>
): Screenshot {
  const width = Math.round(clip.width * scale);
  const height = Math.round(clip.height * scale);
  const quality = jpegQuality(params);
  return {
    format: params.format,
    width,
    height,
    size,
    fullPage: false,
    captureMode: 'element',
    finalTokens: calculateImageTokens(width, height),
    element,
    ...(quality !== undefined && { quality }),
    ...resizeReport(scale !== 1, clip.width, clip.height),
  };
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
