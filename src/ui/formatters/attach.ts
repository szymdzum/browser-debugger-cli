/**
 * Output of `bdg attach` without a tab: the page tabs of the running Chrome.
 */

import type { PageTab } from '@/connection/browserTabs.js';

/**
 * One line per tab: `[0] title — url` (0-based).
 *
 * @param tabs - Page tabs
 * @returns The list
 */
export function formatTabList(tabs: readonly PageTab[]): string {
  void tabs;
  throw new Error('not implemented');
}
