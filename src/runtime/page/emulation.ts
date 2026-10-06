/**
 * Page emulation a session was started with: the viewport size
 * (`--viewport`) and `prefers-color-scheme` (`--color-scheme`).
 *
 * The overrides belong to the session's CDP connection: they last across
 * navigations and reloads, and Chrome drops them when the session ends, so
 * an attached Chrome (`--chrome-ws-url`) gets its own settings back.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { VIEWPORT_SIZE_JS } from '@/runtime/dom/elementGeometry.js';
import type { ColorScheme, ViewportSize } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('session');

/**
 * `Emulation.setDeviceMetricsOverride` parameters for a session viewport: a
 * desktop viewport of that size at the display's own pixel ratio.
 *
 * @param viewport - Viewport size in CSS px
 * @param deviceScaleFactor - Pixel ratio (0 keeps the display's)
 * @returns CDP parameters
 */
export function viewportOverride(
  viewport: ViewportSize,
  deviceScaleFactor = 0
): { width: number; height: number; deviceScaleFactor: number; mobile: false } {
  return { width: viewport.width, height: viewport.height, deviceScaleFactor, mobile: false };
}

/**
 * Apply the session's emulation to its page.
 *
 * @param cdp - Session connection
 * @param emulation - Viewport and color scheme, when given at start
 */
export async function applySessionEmulation(
  cdp: CDPConnection,
  emulation: { viewport?: ViewportSize; colorScheme?: ColorScheme }
): Promise<void> {
  if (emulation.viewport) {
    await cdp.send('Emulation.setDeviceMetricsOverride', viewportOverride(emulation.viewport));
  }
  if (emulation.colorScheme) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: emulation.colorScheme }],
    });
  }
}

/** Page emulation of a session: what `--viewport` and `--color-scheme` set */
export interface SessionEmulation {
  viewport?: ViewportSize;
  colorScheme?: ColorScheme;
}

/**
 * Change the page emulation mid-session (`bdg page emulate`): set the
 * viewport or the color scheme, or clear both (back to the browser window
 * and the system setting).
 *
 * @param cdp - Session connection
 * @param current - Emulation now in effect
 * @param change - What to set, or `reset`
 * @param record - Called after each change Chrome accepted (so a later
 *   failure leaves the recorded emulation true)
 * @returns Emulation in effect afterwards
 */
export async function emulatePage(
  cdp: CDPConnection,
  current: SessionEmulation,
  change: SessionEmulation & { reset?: boolean },
  record: (emulation: SessionEmulation) => void
): Promise<SessionEmulation> {
  let state = current;
  const step = async (send: () => Promise<unknown>, next: SessionEmulation): Promise<void> => {
    await send();
    state = next;
    record(state);
  };
  const { viewport: _viewport, colorScheme, ...rest } = state;
  if (change.reset || change.viewport) {
    await step(
      () =>
        change.viewport
          ? cdp.send('Emulation.setDeviceMetricsOverride', viewportOverride(change.viewport))
          : cdp.send('Emulation.clearDeviceMetricsOverride', {}),
      {
        ...rest,
        ...(colorScheme && { colorScheme }),
        ...(change.viewport && { viewport: change.viewport }),
      }
    );
  }
  if (change.reset || change.colorScheme) {
    const { colorScheme: _scheme, ...withoutScheme } = state;
    await step(
      () =>
        cdp.send('Emulation.setEmulatedMedia', {
          features: [{ name: 'prefers-color-scheme', value: change.colorScheme ?? '' }],
        }),
      { ...withoutScheme, ...(change.colorScheme && { colorScheme: change.colorScheme }) }
    );
  }
  return state;
}

/** How long `bdg status` waits for the page to report its appearance */
const APPEARANCE_TIMEOUT_MS = 1000;

/** What the page currently renders with, for `bdg status` */
export interface PageAppearance {
  /** Layout viewport without scrollbars (as `dom layout` reports it) */
  viewport?: ViewportSize;
  /** `prefers-color-scheme` the page sees */
  colorScheme?: ColorScheme;
}

/**
 * The viewport and color scheme the page renders with. A busy page (or one
 * still navigating) does not answer within {@link APPEARANCE_TIMEOUT_MS}; then
 * nothing is reported rather than holding up `bdg status`.
 *
 * @param cdp - Session connection
 * @returns Viewport and color scheme, or nothing
 */
export async function pageAppearance(cdp: CDPConnection): Promise<PageAppearance> {
  const expression = `(() => {
    const size = (${VIEWPORT_SIZE_JS})(window);
    return { width: Math.round(size.width), height: Math.round(size.height), dark: matchMedia('(prefers-color-scheme: dark)').matches };
  })()`;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), APPEARANCE_TIMEOUT_MS);
  });
  try {
    const response = (await Promise.race([
      cdp.send('Runtime.evaluate', { expression, returnByValue: true }),
      timeout,
    ])) as { result?: { value?: { width: number; height: number; dark: boolean } } } | null;
    const value = response?.result?.value;
    if (!value) return {};
    return {
      viewport: { width: value.width, height: value.height },
      colorScheme: value.dark ? 'dark' : 'light',
    };
  } catch (error) {
    log.debug(`Could not read the page's viewport and color scheme: ${getErrorMessage(error)}`);
    return {};
  } finally {
    clearTimeout(timer);
  }
}
