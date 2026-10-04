/**
 * Follow-mode (live streaming) view. Compact format optimised for
 * repeated polling output.
 */

import type { ConsoleMessage } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';

import { formatSourceLocation, formatTimestamp } from './shared.js';

/**
 * Lines of the console stream: the new messages since the last poll, with
 * the stream header the first time and a separator after a navigation.
 *
 * @param messages - New messages
 * @param options - `header` the first time; `navigationId` when the page changed
 * @returns Text to print (empty when there is nothing new)
 */
export function formatConsoleFollowLines(
  messages: ConsoleMessage[],
  options: { header?: boolean; navigationId?: number } = {}
): string {
  const fmt = new OutputFormatter();
  if (options.header) {
    fmt.text('Streaming console... (Ctrl+C to stop)');
    fmt.separator('━', 40);
    if (messages.length === 0) fmt.text('Waiting for messages...');
  }
  if (options.navigationId !== undefined) {
    fmt.text(`── Next page (navigation #${options.navigationId}) ──`);
  }
  for (const msg of messages) {
    const time = formatTimestamp(msg.timestamp);
    const level = msg.type.padEnd(7);
    fmt.text(`${time} ${level} ${msg.text}`);
    const source = formatSourceLocation(msg.stackTrace);
    if (source) fmt.text(`                → ${source}`);
  }
  return fmt.build();
}
