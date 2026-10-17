/**
 * Follow-mode (live streaming) view. Compact format optimised for
 * repeated polling output.
 */

import { MAX_CONSOLE_TEXT_LENGTH } from '@/constants.js';
import type { ConsoleMessage, PageNavigation } from '@/types.js';
import { capForDisplay } from '@/ui/formatters/longValues.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { displayUrl } from '@/utils/displayUrl.js';

import { pagesEntered } from './pages.js';
import { formatSourceLocation, formatTimestamp } from './shared.js';

/**
 * Lines of the console stream: the new messages since the last poll, with
 * a rule the first time (the stream banner is on stderr) and a separator
 * wherever the stream moves on to a newer page: before the first message of
 * that page, or at the end when the new page has logged nothing yet. Texts
 * are cut like `console --list` cuts them.
 *
 * @param messages - New messages
 * @param options - `header` the first time; `navigations` the session's pages
 *   (the separator names the new page's URL, masked unless `includeSensitive`); `streamNavigationId` the page
 *   the stream was on at the last poll (no separators without it);
 *   `currentNavigationId` the page loaded now; `full` to print the texts whole
 * @returns Text to print (empty when there is nothing new)
 */
export function formatConsoleFollowLines(
  messages: ConsoleMessage[],
  options: {
    header?: boolean;
    streamNavigationId?: number;
    currentNavigationId?: number;
    full?: boolean | undefined;
    navigations?: PageNavigation[];
    includeSensitive?: boolean | undefined;
  } = {}
): string {
  const fmt = new OutputFormatter();
  if (options.header) {
    fmt.separator('━', 40);
    if (messages.length === 0) fmt.text('Waiting for messages...');
  }
  let onPage = options.streamNavigationId;
  const moveTo = (navigationId: number): void => {
    for (const { navigationId: id, url } of pagesEntered(
      options.navigations ?? [],
      onPage,
      navigationId
    )) {
      const page = url === undefined ? '' : `: ${displayUrl(url, options.includeSensitive)}`;
      fmt.text(`── Next page${page} (navigation #${id}) ──`);
    }
    onPage = navigationId;
  };
  for (const msg of messages) {
    const navigationId = msg.navigationId ?? 0;
    if (onPage !== undefined && navigationId > onPage) moveTo(navigationId);
    const time = formatTimestamp(msg.timestamp);
    const level = msg.type.padEnd(7);
    fmt.text(`${time} ${level} ${capForDisplay(msg.text, MAX_CONSOLE_TEXT_LENGTH, options.full)}`);
    const source = formatSourceLocation(msg.stackTrace);
    if (source) fmt.text(`                → ${source}`);
  }
  const { currentNavigationId } = options;
  if (onPage !== undefined && currentNavigationId !== undefined && currentNavigationId !== onPage) {
    moveTo(currentNavigationId);
  }
  return fmt.build();
}
