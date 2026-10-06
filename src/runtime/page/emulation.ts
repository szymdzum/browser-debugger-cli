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
import { hideHeadlessUserAgent } from '@/runtime/page/userAgent.js';
import type { ColorScheme, ViewportSize } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';

const log = createLogger('session');

/** Pixel ratio of an emulated phone (a common one) */
const MOBILE_PIXEL_RATIO = 3;

/**
 * `Emulation.setDeviceMetricsOverride` parameters for a session viewport: a
 * desktop viewport of that size at the display's own pixel ratio, or a
 * phone's (mobile layout: meta viewport, overlay scrollbars; pixel ratio 3).
 *
 * @param viewport - Viewport size in CSS px, `mobile` for a phone
 * @param deviceScaleFactor - Pixel ratio (0 keeps the display's, or a phone's)
 * @returns CDP parameters
 */
export function viewportOverride(
  viewport: ViewportSize,
  deviceScaleFactor = 0
): { width: number; height: number; deviceScaleFactor: number; mobile: boolean } {
  const mobile = viewport.mobile === true;
  return {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: deviceScaleFactor || (mobile ? MOBILE_PIXEL_RATIO : 0),
    mobile,
  };
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
    if (emulation.viewport.mobile) await emulatePhone(cdp, true);
  }
  if (emulation.colorScheme) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: emulation.colorScheme }],
    });
  }
}

/**
 * Turn the rest of a phone's emulation on or off: touch input (and
 * `pointer: coarse`) and a mobile user agent derived from the browser's own
 * (an Android one), or the browser's own back: the override cleared, or in
 * headless Chrome its regular-Chrome identity ({@link hideHeadlessUserAgent}).
 *
 * @param cdp - Session connection
 * @param on - Emulate a phone
 */
async function emulatePhone(cdp: CDPConnection, on: boolean): Promise<void> {
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: on, maxTouchPoints: on ? 5 : 1 });
  const { userAgent } = (await cdp.send('Browser.getVersion', {})) as { userAgent: string };
  if (!on) {
    const headless = userAgent.includes('HeadlessChrome');
    await cdp.send('Emulation.setUserAgentOverride', { userAgent: headless ? userAgent : '' });
    if (headless) await hideHeadlessUserAgent(cdp, log);
    return;
  }
  const major = /Chrome\/(\d+)/.exec(userAgent)?.[1] ?? '';
  await cdp.send('Emulation.setUserAgentOverride', {
    userAgent: mobileUserAgent(userAgent.replace('HeadlessChrome/', 'Chrome/')),
    platform: 'Android',
    userAgentMetadata: {
      brands: [
        { brand: 'Google Chrome', version: major },
        { brand: 'Chromium', version: major },
      ],
      platform: 'Android',
      platformVersion: '10.0.0',
      architecture: '',
      model: 'K',
      mobile: true,
    },
  });
}

/**
 * A mobile user agent from a desktop one: an Android platform, `Mobile`
 * before `Safari`, and `Chrome` for `HeadlessChrome`.
 *
 * @param desktop - The browser's user agent
 * @returns Mobile user agent
 */
export function mobileUserAgent(desktop: string): string {
  return desktop
    .replace(/\([^)]*\)/, '(Linux; Android 10; K)')
    .replace('HeadlessChrome/', 'Chrome/')
    .replace(/ (Mobile )?Safari\//, ' Mobile Safari/');
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
    const wasPhone = current.viewport?.mobile === true;
    const isPhone = change.viewport?.mobile === true;
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
    if (wasPhone !== isPhone) await step(() => emulatePhone(cdp, isPhone), state);
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
