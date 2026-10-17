/**
 * NDJSON view of `console --follow --ndjson`: one JSON object per line, a
 * `page` record wherever the stream moves to another page and a `message`
 * record per console message.
 */

import type { ConsoleMessage, PageNavigation } from '@/types.js';
import { displayUrl } from '@/utils/displayUrl.js';

import { pagesEntered } from './pages.js';
import { capMessageText } from './shared.js';

/** Turns each poll's new messages into NDJSON lines */
export interface ConsoleNdjsonStream {
  /**
   * Lines for one poll.
   *
   * @param messages - New messages, in order
   * @param navigations - Every main-frame navigation of the session
   * @param currentNavigationId - Navigation id of the page loaded now
   * @returns Lines to print, without line breaks
   */
  next(
    messages: ConsoleMessage[],
    navigations: PageNavigation[],
    currentNavigationId?: number
  ): string[];
}

/**
 * Start a console NDJSON stream. A `page` record names a navigation of the
 * session (`navigationId`, `url`); one comes before the first message of each
 * page, for every page the session visited since the previous poll (also one
 * that logged nothing), and for the page loaded now when the poll has no
 * message for it. The first poll starts with the page of its first message,
 * else the page loaded now. A message record is the message as `console --json`
 * lists it, its level in `level` (`type` tells the kind of record).
 *
 * @param options - `--full` and `--include-sensitive`
 * @returns The stream
 */
export function createConsoleNdjson(
  options: { full?: boolean | undefined; includeSensitive?: boolean | undefined } = {}
): ConsoleNdjsonStream {
  let onPage: number | undefined;
  return {
    next(messages, navigations, currentNavigationId) {
      const lines: string[] = [];
      const moveTo = (navigationId: number): void => {
        for (const { url, ...page } of pagesEntered(navigations, onPage, navigationId)) {
          if (url === undefined) continue;
          const shown = displayUrl(url, options.includeSensitive);
          lines.push(JSON.stringify({ type: 'page', ...page, url: shown }));
        }
        onPage = navigationId;
      };
      const isNewer = (navigationId: number): boolean =>
        onPage === undefined || navigationId > onPage;
      for (const message of messages) {
        const navigationId = message.navigationId ?? 0;
        if (isNewer(navigationId)) moveTo(navigationId);
        const { type: level, ...rest } = capMessageText(message, options.full);
        lines.push(JSON.stringify({ type: 'message', level, ...rest }));
      }
      if (currentNavigationId !== undefined && isNewer(currentNavigationId)) {
        moveTo(currentNavigationId);
      }
      return lines;
    },
  };
}
