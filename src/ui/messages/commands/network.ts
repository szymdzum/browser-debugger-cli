/**
 * Network messages.
 */

import { sessionCommand } from '@/ui/messages/sessionCommand.js';

/**
 * Note under a shortened list of requests an action triggered when JSON
 * output left some out too (they are only in the network telemetry then).
 *
 * @param hidden - Requests not listed
 * @returns e.g. "... and 50 more (see bdg network list)"
 */
export function moreRequestsNote(hidden: number): string {
  return `... and ${hidden} more (see ${sessionCommand('bdg network list')})`;
}

/**
 * Title of the list of requests that started while an action ran (they are
 * attributed by time, so a page poller's requests are listed too: the title
 * doesn't claim the action caused them).
 *
 * @param total - Requests in all
 * @returns e.g. "Requests during the action (18):"
 */
export function triggeredRequestsTitle(total: number): string {
  return `Requests during the action (${total}):`;
}

/**
 * Line counting the static assets an action loaded instead of listing them.
 *
 * @param count - Asset requests
 * @param types - Short type names, e.g. ["css", "js", "images"]
 * @returns e.g. "+ 97 assets (css, js, fonts, images)"
 */
export function assetRequestsNote(count: number, types: string[]): string {
  return `+ ${count} ${count === 1 ? 'asset' : 'assets'} (${types.join(', ')})`;
}
