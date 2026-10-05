/**
 * Console command messages (bdg console)
 *
 * User-facing messages for the console command output and formatting.
 */

import type { ConsoleSkipped } from '@/ui/formatters/console/shared.js';
import { pluralize } from '@/ui/formatting.js';

/**
 * Generate message for following console output.
 *
 * @returns Status message for stderr
 */
export function followingConsoleMessage(): string {
  return 'Streaming console messages... (Ctrl+C to stop)';
}

/**
 * Generate message when stopping console follow mode.
 *
 * @returns Status message for stderr
 */
export function stoppedFollowingConsoleMessage(): string {
  return 'Stopped streaming console messages';
}

/**
 * Note under a console list whose indices skip messages: the indices are
 * positions in the session's message list (what `bdg details console <n>`
 * takes), and the messages in between were left out by the filters.
 *
 * @param skipped - Messages left out between the first and last listed index
 * @returns e.g. `[n] are positions in the session's message list; not listed in between: 1 message from another page load (-H lists all)`
 */
export function consoleIndexGapNote(skipped: ConsoleSkipped): string {
  const reasons = [
    skipped.otherLevels > 0 && `${pluralize(skipped.otherLevels, 'message')} of another level`,
    skipped.otherPages > 0 &&
      `${pluralize(skipped.otherPages, 'message')} from another page load (-H lists all)`,
  ].filter(Boolean);
  return `[n] are positions in the session's message list; not listed in between: ${reasons.join(', ')}`;
}
