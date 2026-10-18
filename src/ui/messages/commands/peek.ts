/**
 * Peek messages.
 */

import type { PageLoadingState } from '@/ipc/protocol/commands.js';

import { pageLoadingWarning, pageCrashedNote } from './shared.js';

/**
 * First line of `bdg status` for a running session.
 *
 * @param page - URL and title of the page, when the session reported them,
 *   and when it crashed
 * @returns e.g. `Session active: https://example.com/ — Example Domain`, with
 *   a crash warning on a second line
 */
export function sessionActiveLine(page?: {
  url: string;
  title: string;
  crashedAt?: number | undefined;
  loading?: PageLoadingState | undefined;
}): string {
  if (!page) return 'Session active';
  const line = `Session active: ${page.url}${page.title ? ` — ${page.title}` : ''}`;
  return [
    line,
    ...(page.loading ? [`⚠ ${pageLoadingWarning(page.loading)}`] : []),
    ...(page.crashedAt === undefined ? [] : [pageCrashedNote(page.crashedAt)]),
  ].join('\n');
}

/**
 * The page's URL and title as the first lines of `bdg peek`.
 *
 * @param page - URL, title and loading state of the page
 * @returns e.g. `Page: https://example.com/ — Example Domain`, with the loading state on a second line
 */
export function peekPageLines(page: {
  url: string;
  title: string;
  loading?: PageLoadingState | undefined;
}): string[] {
  if (!page.url) return [];
  return [
    `Page: ${page.url}${page.title ? ` — ${page.title}` : ''}`,
    ...(page.loading ? [`⚠ ${pageLoadingWarning(page.loading)}`] : []),
  ];
}

/**
 * Hint on an empty `Performance.getMetrics` result: the domain reports no
 * metrics until it is enabled.
 */
export const PERFORMANCE_METRICS_EMPTY_HINT =
  'Metrics are empty until the Performance domain is enabled: run bdg cdp Performance.enable first, then Performance.getMetrics again';
