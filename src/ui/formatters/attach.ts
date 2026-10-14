/**
 * Output of `bdg attach` without a tab: the page tabs of the running Chrome.
 */

import type { PageTab } from '@/connection/browserTabs.js';

/**
 * One line per tab (titles and URLs over 80 characters cut): `[0] title — url` (0-based).
 *
 * @param tabs - Page tabs
 * @returns The list
 */
export function formatTabList(tabs: readonly PageTab[]): string {
  return tabs
    .map((tab) => `[${tab.index}] ${cut(tab.title || '(no title)')} — ${cut(tab.url)}`)
    .join('\n');
}

/** Longest title or URL shown in the list (`--json` has them in full) */
const MAX_FIELD_LENGTH = 80;

/**
 * A title or URL cut to {@link MAX_FIELD_LENGTH} characters.
 *
 * @param text - Title or URL
 * @returns The text, ending in … when cut
 */
function cut(text: string): string {
  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH - 1)}…` : text;
}
