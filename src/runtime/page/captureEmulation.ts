/**
 * Page emulation a screenshot changes for its capture, and puts back.
 *
 * A capture at a pixel ratio of 1 on a high-DPI page, and one beyond the
 * viewport, override the device metrics (and hide the scrollbars). Chrome
 * itself lays the page out at the captured size for a capture beyond the
 * viewport and, putting the size back, keeps the page laid out without its
 * scrollbar (#514); only a change of the viewport's size lays it out again.
 * Each change is recorded before it is sent, so
 * {@link CaptureEmulation.restore} (called once the capture ended, however it
 * ended) undoes exactly what may have been changed: the session's emulation
 * is put back from the daemon's own record of it as it is then (a
 * `page emulate` during the capture counts), not from a file.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import { evaluateInBdgWorld } from '@/runtime/page/bdgWorld.js';
import { viewportOverride } from '@/runtime/page/emulation.js';
import type { ViewportSize } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('dom');

/** Width and height in CSS px */
export interface Size {
  width: number;
  height: number;
}

/** A page position in CSS px */
export interface ScrollPosition {
  x: number;
  y: number;
}

/**
 * Evaluate one of bdg's page scripts and return its value.
 *
 * @param cdp - Session connection
 * @param expression - Script
 * @returns Its value, or undefined when it threw
 */
export async function evaluateValue(cdp: CDPConnection, expression: string): Promise<unknown> {
  const response = await evaluateInBdgWorld(cdp, { expression, returnByValue: true });
  return response.result.value as unknown;
}

/**
 * Two numbers a page script returned as an array.
 *
 * @param cdp - Session connection
 * @param expression - Script returning `[a, b]`
 * @returns The numbers, undefined where the page did not answer
 */
export async function evaluatePair(
  cdp: CDPConnection,
  expression: string
): Promise<[number | undefined, number | undefined]> {
  const value = await evaluateValue(cdp, expression);
  const [a, b] = Array.isArray(value) ? (value as number[]) : [];
  return [a, b];
}

/**
 * The page's scroll position.
 *
 * @param cdp - Session connection
 * @returns Scroll offsets in CSS px
 */
export async function scrollPosition(cdp: CDPConnection): Promise<ScrollPosition> {
  const [x, y] = await evaluatePair(cdp, '[window.scrollX, window.scrollY]');
  return { x: x ?? 0, y: y ?? 0 };
}

/**
 * The emulation changes of one capture, undone by {@link restore}.
 */
export class CaptureEmulation {
  private readonly cdp: TypedCDPConnection;
  private metricsChanged = false;
  private scrollbarsHidden = false;
  private beyondViewport: Size | undefined;
  private scrolledFrom: ScrollPosition | undefined;

  /**
   * @param connection - Session connection
   * @param sessionViewport - Reads the session's emulated viewport
   *   (`--viewport`, `--mobile`, `page emulate`) as it is now; put back
   *   afterwards, none clears the override
   */
  constructor(
    private readonly connection: CDPConnection,
    private readonly sessionViewport: () => ViewportSize | undefined
  ) {
    this.cdp = new TypedCDPConnection(connection);
  }

  /**
   * Capture at a pixel ratio of 1 (CSS px = image px) on a high-DPI page:
   * the viewport is overridden at the session's viewport, else the window's
   * size with its scrollbars (so the layout does not change).
   *
   * @param devicePixelRatio - Page's pixel ratio
   * @param viewport - Visible viewport size, used when the page does not answer
   */
  async useUnitPixelRatio(devicePixelRatio: number, viewport: Size): Promise<void> {
    if (devicePixelRatio === 1) return;
    const size = this.sessionViewport() ?? (await this.windowSize(viewport));
    this.metricsChanged = true;
    await this.cdp.send('Emulation.setDeviceMetricsOverride', viewportOverride(size, 1));
  }

  /**
   * Lay the page out at its current width without scrollbars: a capture
   * beyond the viewport hides them, and without this the page would widen by
   * the scrollbar and centered content move after it was measured. The
   * viewport is overridden at the visible size (CSS px, pixel ratio 1; still
   * a phone in a phone session).
   *
   * @param view - Visible viewport size
   */
  async keepLayoutWithoutScrollbars(view: Size): Promise<void> {
    const phone = this.sessionViewport()?.mobile;
    this.scrollbarsHidden = true;
    await this.cdp.send('Emulation.setScrollbarsHidden', { hidden: true });
    this.metricsChanged = true;
    await this.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      viewportOverride({ ...roundSize(view), ...(phone && { mobile: true }) }, 1)
    );
  }

  /**
   * Record a capture beyond the viewport: Chrome lays the page out at the
   * captured size, so the restore lays it out again at the session's size.
   *
   * @param view - Visible viewport size, used when the page does not answer
   */
  capturesBeyondViewport(view: Size): void {
    this.beyondViewport = view;
  }

  /**
   * Record where the page was scrolled before the capture moved it, to
   * scroll it back afterwards (the first position recorded wins).
   *
   * @param position - Scroll position before the capture
   */
  scrolledAwayFrom(position: ScrollPosition): void {
    this.scrolledFrom ??= position;
  }

  /**
   * Put back what the capture changed: scrollbars shown, the session's
   * device metrics (its viewport and a phone's touch input, which a capture
   * beyond the viewport turns off), else none, and the scroll position. Each
   * step runs even when an earlier one failed.
   *
   * @throws The first step's error, once every step ran
   */
  async restore(): Promise<void> {
    const failures: unknown[] = [];
    for (const [name, step] of this.restoreSteps()) {
      try {
        await step();
      } catch (error) {
        log.debug(`Screenshot restore (${name}) failed: ${getErrorMessage(error)}`);
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  }

  /**
   * The steps {@link restore} runs, for what the capture changed.
   *
   * @returns Named steps, in order
   */
  private restoreSteps(): Array<[string, () => Promise<unknown>]> {
    const steps: Array<[string, () => Promise<unknown>]> = [];
    if (this.scrollbarsHidden) {
      steps.push([
        'scrollbars',
        () => this.cdp.send('Emulation.setScrollbarsHidden', { hidden: false }),
      ]);
    }
    if (this.metricsChanged || this.beyondViewport)
      steps.push(['device metrics', () => this.restoreSessionMetrics()]);
    const scrolledFrom = this.scrolledFrom;
    if (scrolledFrom) {
      const { x, y } = scrolledFrom;
      steps.push(['scroll', () => evaluateValue(this.connection, `window.scrollTo(${x}, ${y})`)]);
    }
    return steps;
  }

  /**
   * Put back the session's device metrics, or clear the override; after a
   * capture beyond the viewport, lay the page out at another size first.
   */
  private async restoreSessionMetrics(): Promise<void> {
    const viewport = this.sessionViewport();
    if (this.beyondViewport) {
      await this.layOutAgain(viewport, this.beyondViewport);
      return;
    }
    await this.applySessionMetrics(viewport);
  }

  /**
   * Override the viewport one CSS px taller than the size it is put back at
   * (the session's viewport, else the window's), then put that size back:
   * Chrome lays the page out again, with its scrollbars, only when the
   * viewport's size changes, and a capture beyond the viewport left it laid
   * out without them (#514). Each change is waited for in the page, so the
   * next command reads the size put back, not the taller one.
   *
   * @param viewport - Session's viewport, if any
   * @param view - Visible viewport size, used when the page does not answer
   */
  private async layOutAgain(viewport: ViewportSize | undefined, view: Size): Promise<void> {
    const before = await this.windowSize(view);
    const size = viewport ?? before;
    await this.cdp.send(
      'Emulation.setDeviceMetricsOverride',
      viewportOverride({ ...size, height: size.height + 1 })
    );
    const taller = await windowResizedFrom(this.connection, before);
    await this.applySessionMetrics(viewport);
    if (taller) await windowResizedFrom(this.connection, taller);
  }

  /**
   * Put back the session's device metrics (its viewport and a phone's touch
   * input, which a capture beyond the viewport turns off), else clear the
   * override.
   *
   * @param viewport - Session's viewport, if any
   */
  private async applySessionMetrics(viewport: ViewportSize | undefined): Promise<void> {
    if (!viewport) {
      await this.cdp.send('Emulation.clearDeviceMetricsOverride', {});
      return;
    }
    await this.cdp.send('Emulation.setDeviceMetricsOverride', viewportOverride(viewport));
    if (viewport.mobile) {
      await this.cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 5,
      });
    }
  }

  /**
   * The window's size with its scrollbars (`innerWidth`/`innerHeight`): an
   * override at this size keeps the page's layout, where the visible size
   * (without scrollbars) would narrow it and move centered content.
   *
   * @param viewport - Visible viewport size, used when the page does not answer
   * @returns Width and height in CSS px
   */
  private async windowSize(viewport: Size): Promise<Size> {
    const [width, height] = await evaluatePair(
      this.connection,
      '[window.innerWidth, window.innerHeight]'
    );
    return {
      width: Math.round(width ?? viewport.width),
      height: Math.round(height ?? viewport.height),
    };
  }
}

/**
 * A size in whole CSS px, as `Emulation.setDeviceMetricsOverride` takes it
 * (a phone's visible viewport is fractional).
 *
 * @param size - Size
 * @returns Rounded size
 */
function roundSize(size: Size): Size {
  return { width: Math.round(size.width), height: Math.round(size.height) };
}

/** How long the page is watched for a metrics change to reach it */
const RESIZE_WAIT_MS = 1000;

/**
 * Wait until the page's window (`innerWidth`/`innerHeight`) is no longer the
 * given size: Chrome answers a metrics change before the page has it, and on
 * Linux a command right after could still read the old size.
 *
 * @param cdp - Session connection
 * @param size - Size the window had
 * @returns The new size, undefined when it did not change within
 *   {@link RESIZE_WAIT_MS} or the page did not answer
 */
async function windowResizedFrom(cdp: CDPConnection, size: Size): Promise<Size | undefined> {
  const expression = `new Promise((resolve) => {
    const end = Date.now() + ${RESIZE_WAIT_MS};
    const check = () => {
      if (innerWidth !== ${size.width} || innerHeight !== ${size.height}) resolve([innerWidth, innerHeight]);
      else if (Date.now() > end) resolve(null);
      else setTimeout(check, 10);
    };
    check();
  })`;
  const response = await evaluateInBdgWorld(cdp, {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  const value = response.result.value as unknown;
  if (!Array.isArray(value)) {
    log.debug(`Screenshot restore: the window stayed ${size.width}x${size.height}`);
    return undefined;
  }
  const [width, height] = value as number[];
  return { width: width ?? size.width, height: height ?? size.height };
}
