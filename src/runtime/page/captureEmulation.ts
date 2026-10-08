/**
 * Page emulation a screenshot changes for its capture, and puts back.
 *
 * A capture at a pixel ratio of 1 on a high-DPI page, and one beyond the
 * viewport, override the device metrics (and hide the scrollbars). Each
 * change is recorded before it is sent, so {@link CaptureEmulation.restore}
 * (called once the capture ended, however it ended) undoes exactly what may
 * have been changed: the session's emulation is put back from the daemon's
 * own record of it as it is then (a `page emulate` during the capture
 * counts), not from a file.
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
      viewportOverride({ ...view, ...(phone && { mobile: true }) }, 1)
    );
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
    if (this.metricsChanged) steps.push(['device metrics', () => this.restoreSessionMetrics()]);
    const scrolledFrom = this.scrolledFrom;
    if (scrolledFrom) {
      const { x, y } = scrolledFrom;
      steps.push(['scroll', () => evaluateValue(this.connection, `window.scrollTo(${x}, ${y})`)]);
    }
    return steps;
  }

  /**
   * Put back the session's device metrics, or clear the override.
   */
  private async restoreSessionMetrics(): Promise<void> {
    const viewport = this.sessionViewport();
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
