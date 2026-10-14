/**
 * Whether Chrome renders an attached tab: commands that wait for a rendered
 * frame (`dom screenshot`) would never be answered on a tab Chrome does not
 * render (a background tab of headless Linux Chrome), so they fail fast.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import { backgroundTabError } from '@/errors/messages.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** How long the tab gets to render a frame before it counts as not rendered */
export const RENDERED_FRAME_TIMEOUT_MS = 2000;

/** Resolves on the page's next animation frame */
const NEXT_FRAME = 'new Promise((resolve) => requestAnimationFrame(() => resolve(true)))';

/**
 * Refuse a command that needs a rendered frame while Chrome renders no frame
 * of the tab. `document.visibilityState` cannot tell: bdg's focus emulation
 * makes it `visible` on a background tab, so the tab is asked for an
 * animation frame instead. bdg never brings the tab to the front: the
 * browser is the user's.
 *
 * @param cdp - The tab's connection
 * @param timeoutMs - How long to wait for a frame
 * @throws CommandError (85) when no frame comes in time
 */
export async function assertTabRendered(
  cdp: CDPConnection,
  timeoutMs: number = RENDERED_FRAME_TIMEOUT_MS
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const frame = cdp
    .send('Runtime.evaluate', { expression: NEXT_FRAME, awaitPromise: true, returnByValue: true })
    .then(() => true);
  try {
    if (await Promise.race([frame, timedOut])) return;
  } finally {
    clearTimeout(timer);
  }
  const err = backgroundTabError();
  throw new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.RESOURCE_BUSY);
}
