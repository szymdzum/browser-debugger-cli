/**
 * Follow-mode (live streaming) view. Compact format optimised for
 * repeated polling output.
 */

import type { ConsoleMessage } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';

import { formatSourceLocation, formatTimestamp } from './shared.js';

/**
 * Format console output for follow mode streaming.
 */
export function formatConsoleFollow(messages: ConsoleMessage[]): string {
  const fmt = new OutputFormatter();

  fmt.text('Streaming console... (Ctrl+C to stop)');
  fmt.separator('━', 40);

  if (messages.length === 0) {
    fmt.text('Waiting for messages...');
    return fmt.build();
  }

  for (const msg of messages) {
    const time = formatTimestamp(msg.timestamp);
    const level = msg.type.padEnd(7);
    fmt.text(`${time} ${level} ${msg.text}`);

    const source = formatSourceLocation(msg.stackTrace);
    if (source) {
      fmt.text(`                → ${source}`);
    }
  }

  return fmt.build();
}
