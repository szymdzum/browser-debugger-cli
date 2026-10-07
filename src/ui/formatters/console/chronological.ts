/**
 * Chronological list view (--list mode): all messages with timestamps,
 * level prefixes, and navigation reload markers.
 */

import { MAX_CONSOLE_TEXT_LENGTH } from '@/constants.js';
import type { ConsoleMessage } from '@/types.js';
import { capForDisplay } from '@/ui/formatters/longValues.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { consoleDroppedNote, consoleIndexGapNote } from '@/ui/messages/consoleMessages.js';

import { formatSourceLocation, formatTimestamp, type ConsoleFormatOptions } from './shared.js';

/**
 * Format console output as chronological list (--list mode).
 *
 * Shows all messages in order with timestamps and levels. Includes
 * navigation markers when page reloads are detected.
 */
export function formatConsoleChronological(
  messages: ConsoleMessage[],
  options: ConsoleFormatOptions
): string {
  const fmt = new OutputFormatter();

  const displayMessages = lastMessages(messages, options.last);

  const headerSuffix = options.history ? ' (all navigations)' : '';
  const header =
    displayMessages.length === messages.length
      ? `Console Messages (${messages.length} total)${headerSuffix}`
      : `Console Messages (last ${displayMessages.length} of ${messages.length})${headerSuffix}`;

  fmt.text(header);
  fmt.separator('━', 50);
  if (options.dropped) fmt.text(consoleDroppedNote(options.dropped));

  if (displayMessages.length === 0) {
    fmt.text('No console messages');
    return fmt.build();
  }

  const baseIndex = messages.length - displayMessages.length;
  const indexOf = (msg: ConsoleMessage, i: number): number => msg.index ?? baseIndex + i;
  const indexWidth = Math.max(...displayMessages.map((m, i) => `[${indexOf(m, i)}]`.length));
  const levelWidth = Math.max(7, ...displayMessages.map((m) => m.type.length));
  const sourceIndent = ' '.repeat(indexWidth + 2 + levelWidth + 1);
  let lastNavigationId: number | undefined;

  for (const [i, msg] of displayMessages.entries()) {
    const index = `[${indexOf(msg, i)}]`.padEnd(indexWidth);
    const time = formatTimestamp(msg.timestamp);
    const level = msg.type.padEnd(levelWidth);

    if (msg.navigationId !== undefined && msg.navigationId !== lastNavigationId) {
      if (lastNavigationId !== undefined) {
        fmt.blank();
        fmt.text(`─── Next page (navigation #${msg.navigationId}) ───`);
        fmt.blank();
      }
      lastNavigationId = msg.navigationId;
    }

    const text = capForDisplay(msg.text, MAX_CONSOLE_TEXT_LENGTH, options.full);
    fmt.text(`${index}  ${level} ${time}  ${text}`);

    const source = formatSourceLocation(msg.stackTrace);
    if (source) {
      fmt.text(`${sourceIndent}→ ${source}`);
    }
  }

  const { skipped } = options;
  if (skipped && skipped.otherPages + skipped.otherLevels > 0) {
    fmt.blank();
    fmt.text(consoleIndexGapNote(skipped));
  }
  return fmt.build();
}

/**
 * The messages `--last` selects: the last N (all for 0 or none).
 *
 * @param messages - Messages after the page and level filters
 * @param last - `--last` value
 * @returns The messages to list
 */
export function lastMessages(
  messages: ConsoleMessage[],
  last: number | undefined
): ConsoleMessage[] {
  return last && last > 0 ? messages.slice(-last) : messages;
}
