/**
 * The pages a console stream enters between two polls, for the text
 * separators and the NDJSON `page` records alike.
 */

import type { PageNavigation } from '@/types.js';

/** A page entered: its navigation id and, when the session recorded it, its URL */
export interface PageStep {
  navigationId: number;
  url?: string;
}

/**
 * The pages entered when the stream moves on to a page: every recorded
 * navigation after `from` up to `to`, so a page that logged nothing is
 * entered too; without `from`, only `to`. A page the session has no record of
 * is entered without a URL.
 *
 * @param navigations - The session's navigations known so far
 * @param from - Navigation id the stream was on (none: it is starting)
 * @param to - Navigation id the stream moves to
 * @returns Pages entered, oldest first
 */
export function pagesEntered(
  navigations: PageNavigation[],
  from: number | undefined,
  to: number
): PageStep[] {
  const after = from ?? to - 1;
  const entered = navigations
    .filter(({ navigationId }) => navigationId > after && navigationId <= to)
    .sort((a, b) => a.navigationId - b.navigationId);
  return entered.length > 0 ? entered : [{ navigationId: to }];
}
