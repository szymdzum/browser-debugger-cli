/**
 * Console command messages (bdg console)
 *
 * User-facing messages for the console command output and formatting.
 */

import { MAX_CONSOLE_MESSAGES } from '@/constants.js';
import type { ConsoleLevel } from '@/types.js';
import type { ConsoleSkipped, HiddenByLevel } from '@/ui/formatters/console/shared.js';
import { pluralize } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';

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
 * Error for `console --ndjson` without `--follow`.
 *
 * @returns Message and suggestion
 */
export function ndjsonNeedsFollow(): { message: string; suggestion: string } {
  return {
    message: '--ndjson streams console messages and needs --follow',
    suggestion: 'Add --follow: bdg console --follow --ndjson',
  };
}

/**
 * Error for `console --ndjson` together with `--json`.
 *
 * @returns Message and suggestion
 */
export function ndjsonConflictsWithJson(): { message: string; suggestion: string } {
  return {
    message: '--ndjson and --json are two output formats: use one',
    suggestion: 'One record per line: bdg console --follow --ndjson',
  };
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

/** Order of the levels in the hidden-messages note; `other` are dir, table, groups, ... */
const HIDDEN_ORDER = ['error', 'warning', 'info', 'debug', 'other'] as const;

/**
 * Note under the header of a `--level` list: how many messages the filter hid.
 *
 * @param level - The `--level` value
 * @param hidden - Hidden messages per level
 * @returns e.g. `3 messages hidden by --level error (2 info, 1 warning)`
 */
export function consoleHiddenByLevelNote(level: ConsoleLevel, hidden: HiddenByLevel): string {
  const counts = HIDDEN_ORDER.flatMap((name) => {
    const count = hidden[name];
    return count ? [{ name, count }] : [];
  });
  const total = counts.reduce((sum, { count }) => sum + count, 0);
  const detail = counts
    .map(({ name, count }) => `${count} ${name === 'other' ? 'other types' : name}`)
    .join(', ');
  return `${pluralize(total, 'message')} hidden by --level ${level} (${detail})`;
}

/**
 * Note that the session dropped its oldest console messages at the limit.
 *
 * @param dropped - Messages dropped
 * @returns e.g. `⚠ 2000 older console messages were dropped: bdg keeps the newest 10000`
 */
export function consoleDroppedNote(dropped: number): string {
  return `⚠ ${pluralize(dropped, 'older console message')} ${dropped === 1 ? 'was' : 'were'} dropped: bdg keeps the newest ${MAX_CONSOLE_MESSAGES}`;
}

/**
 * Error for `bdg details console <n>` with the index of a dropped message.
 *
 * @param index - Index asked for
 * @param dropped - Messages dropped (the first kept has this index)
 * @returns Message
 */
export function consoleMessageDroppedError(index: number, dropped: number): string {
  return `Console message ${index} was dropped: bdg keeps the newest ${MAX_CONSOLE_MESSAGES} messages (the oldest kept is ${dropped})`;
}

/**
 * Note under the console summary when it lists only the newest distinct
 * errors or warnings.
 *
 * @param more - Distinct messages not listed
 * @param level - `error` or `warning`
 * @returns e.g. `(+120 earlier distinct errors; bdg console --level error --last 0 lists every one)`
 */
export function consoleMoreGroupsNote(more: number, level: 'error' | 'warning'): string {
  return `(+${more} earlier distinct ${more === 1 ? level : `${level}s`}; ${sessionCommand(`bdg console --level ${level} --last 0`)} lists every one)`;
}
