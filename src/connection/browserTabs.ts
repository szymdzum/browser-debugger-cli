/**
 * Page tabs of a running Chrome, read over its browser-level connection
 * (`Target.getTargets`), and choosing one by URL/title substring or index
 * (`bdg attach`).
 */

import type { CDPConnection } from '@/connection/cdp.js';
import { CommandError } from '@/errors/index.js';
import {
  noTabMatchesError,
  severalTabsMatchError,
  attachIndexOutOfRangeError,
} from '@/errors/messages.js';
import { formatTabList } from '@/ui/formatters/attach.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/** A `bdg attach` argument that is an index from the tab list */
const INDEX_PATTERN = /^\d+$/;

/** A page tab of the browser, in `Target.getTargets` order */
export interface PageTab {
  /** 0-based position among the browser's page tabs */
  index: number;
  targetId: string;
  title: string;
  url: string;
}

/** What `Target.getTargets` reports per target (the fields used here) */
export interface BrowserTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
}

/**
 * The page tabs among a browser's targets, numbered from 0.
 *
 * @param targetInfos - Targets from `Target.getTargets`
 * @returns Page tabs
 */
export function pageTabs(targetInfos: readonly BrowserTargetInfo[]): PageTab[] {
  return targetInfos
    .filter((target) => target.type === 'page')
    .map(({ targetId, title, url }, index) => ({ index, targetId, title, url }));
}

/**
 * The browser's page tabs, read over a browser-level connection.
 *
 * @param cdp - Connection to the browser endpoint
 * @returns Page tabs
 */
export async function listPageTabs(cdp: CDPConnection): Promise<PageTab[]> {
  const { targetInfos } = (await cdp.sendToBrowser('Target.getTargets')) as {
    targetInfos: BrowserTargetInfo[];
  };
  return pageTabs(targetInfos);
}

/**
 * The tab a `bdg attach` argument names: an index from the list, or the only
 * tab whose URL or title contains it (case-insensitive).
 *
 * @param tabs - The browser's page tabs
 * @param query - Index or pattern
 * @returns The tab
 * @throws CommandError 83 when nothing matches, 81 for several matches or an index out of range
 */
export function matchTab(tabs: readonly PageTab[], query: string): PageTab {
  if (INDEX_PATTERN.test(query)) {
    const tab = tabs[Number(query)];
    if (tab) return tab;
    fail(attachIndexOutOfRangeError(Number(query), formatTabList(tabs), tabs.length));
  }
  const needle = query.toLowerCase();
  const matches = tabs.filter(
    (tab) => tab.url.toLowerCase().includes(needle) || tab.title.toLowerCase().includes(needle)
  );
  const [only] = matches;
  if (only && matches.length === 1) return only;
  if (!only) fail(noTabMatchesError(query, formatTabList(tabs)), EXIT_CODES.RESOURCE_NOT_FOUND);
  return fail(severalTabsMatchError(query, formatTabList(matches), matches.length));
}

/**
 * Throw a tab-choice error.
 *
 * @param err - Message and suggestion
 * @param exitCode - Exit code (default 81)
 * @throws CommandError always
 */
function fail(
  err: { message: string; suggestion: string },
  exitCode: number = EXIT_CODES.INVALID_ARGUMENTS
): never {
  throw new CommandError(err.message, { suggestion: err.suggestion }, exitCode);
}
