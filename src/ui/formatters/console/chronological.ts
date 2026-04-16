/**
 * Chronological list view (--list mode): all messages with timestamps,
 * level prefixes, and navigation reload markers.
 */

import type { ConsoleMessage } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { truncateByLength } from '@/utils/strings.js';

import { formatSourceLocation, formatTimestamp, type ConsoleFormatOptions } from './shared.js';

const MAX_LIST_TEXT_LENGTH = 200;

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

  let displayMessages = messages;
  if (options.last && options.last > 0) {
    displayMessages = messages.slice(-options.last);
  }

  const headerSuffix = options.history ? ' (all navigations)' : '';
  const header =
    displayMessages.length === messages.length
      ? `Console Messages (${messages.length} total)${headerSuffix}`
      : `Console Messages (last ${displayMessages.length} of ${messages.length})${headerSuffix}`;

  fmt.text(header);
  fmt.separator('━', 50);

  if (displayMessages.length === 0) {
    fmt.text('No console messages');
    return fmt.build();
  }

  const baseIndex = messages.length - displayMessages.length;
  let lastNavigationId: number | undefined;

  for (const [i, msg] of displayMessages.entries()) {
    const index = baseIndex + i;
    const time = formatTimestamp(msg.timestamp);
    const level = msg.type.padEnd(7);

    if (msg.navigationId !== undefined && msg.navigationId !== lastNavigationId) {
      if (lastNavigationId !== undefined) {
        fmt.blank();
        fmt.text(`─── Page Reload (navigation #${msg.navigationId}) ───`);
        fmt.blank();
      }
      lastNavigationId = msg.navigationId;
    }

    const truncatedText = truncateByLength(msg.text, MAX_LIST_TEXT_LENGTH);
    fmt.text(`[${index}]  ${level} ${time}  ${truncatedText}`);

    const source = formatSourceLocation(msg.stackTrace);
    if (source) {
      fmt.text(`                      → ${source}`);
    }
  }

  return fmt.build();
}
