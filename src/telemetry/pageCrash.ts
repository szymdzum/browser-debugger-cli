/**
 * Renderer crash tracking: Chrome reports a crashed page with
 * `Inspector.targetCrashed` and keeps the connection open, so without this a
 * session looks active while every page command waits for a timeout. A
 * reload (or any main-frame navigation) brings the page back.
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CDPHandlerRegistry } from '@/connection/handlers.js';
import { TypedCDPConnection } from '@/connection/typed-cdp.js';
import { CommandError } from '@/errors/index.js';
import { pageCrashedError } from '@/errors/messages.js';
import type { CleanupFunction } from '@/types.js';
import { createLogger } from '@/ui/logging/index.js';
import { getErrorMessage } from '@/utils/errors.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

const log = createLogger('page-crash');

/**
 * Start tracking renderer crashes of the page.
 *
 * @param cdp - CDP connection to the page
 * @param onChange - Called with the crash time when the page crashes, and
 *   with undefined when it is loaded again
 * @returns Cleanup that stops tracking
 */
export async function startCrashTracking(
  cdp: CDPConnection,
  onChange: (crashedAt: number | undefined) => void
): Promise<CleanupFunction> {
  const registry = new CDPHandlerRegistry();
  const typed = new TypedCDPConnection(cdp);
  registry.registerTyped(typed, 'Inspector.targetCrashed', () => {
    log.info('The page crashed (renderer gone)');
    onChange(Date.now());
  });
  registry.registerTyped(typed, 'Inspector.targetReloadedAfterCrash', () => onChange(undefined));
  registry.registerTyped(typed, 'Page.frameNavigated', ({ frame }) => {
    if (frame.parentId === undefined) onChange(undefined);
  });
  try {
    await cdp.send('Inspector.enable');
  } catch (error) {
    log.debug(`Crash reports unavailable: ${getErrorMessage(error)}`);
  }
  return () => registry.cleanup();
}

/**
 * Error for a page command after the page's renderer crashed (exit 107).
 *
 * @param crashedAt - When it crashed (epoch ms)
 * @returns Error with the way back
 */
export function pageCrashedCommandError(crashedAt: number): CommandError {
  const err = pageCrashedError(crashedAt);
  return new CommandError(err.message, { suggestion: err.suggestion }, EXIT_CODES.PAGE_CRASHED);
}
