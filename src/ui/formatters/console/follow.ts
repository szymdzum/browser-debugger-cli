/**
 * Follow-mode (live streaming) view. Compact format optimised for
 * repeated polling output.
 */

import { MAX_CONSOLE_TEXT_LENGTH } from '@/constants.js';
import type { ConsoleMessage } from '@/types.js';
import { capForDisplay } from '@/ui/formatters/longValues.js';
import { OutputFormatter } from '@/ui/formatting.js';

import { formatSourceLocation, formatTimestamp } from './shared.js';

/**
 * Lines of the console stream: the new messages since the last poll, with
 * a rule the first time (the stream banner is on stderr) and a separator
 * after a navigation. Texts are cut like `console --list` cuts them.
 *
 * @param messages - New messages
 * @param options - `header` the first time; `navigationId` when the page
 *   changed; `full` to print the texts whole
 * @returns Text to print (empty when there is nothing new)
 */
export function formatConsoleFollowLines(
  messages: ConsoleMessage[],
  options: { header?: boolean; navigationId?: number; full?: boolean | undefined } = {}
): string {
  const fmt = new OutputFormatter();
  if (options.header) {
    fmt.separator('━', 40);
    if (messages.length === 0) fmt.text('Waiting for messages...');
  }
  if (options.navigationId !== undefined) {
    fmt.text(`── Next page (navigation #${options.navigationId}) ──`);
  }
  for (const msg of messages) {
    const time = formatTimestamp(msg.timestamp);
    const level = msg.type.padEnd(7);
    fmt.text(`${time} ${level} ${capForDisplay(msg.text, MAX_CONSOLE_TEXT_LENGTH, options.full)}`);
    const source = formatSourceLocation(msg.stackTrace);
    if (source) fmt.text(`                → ${source}`);
  }
  return fmt.build();
}
