/**
 * Page tabs of a running Chrome, read over its browser-level connection
 * (`Target.getTargets`), and choosing one by URL/title substring or index
 * (`bdg attach`).
 */

import type { CDPConnection } from '@/connection/cdp.js';

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
  void targetInfos;
  throw new Error('not implemented');
}

/**
 * The browser's page tabs, read over a browser-level connection.
 *
 * @param cdp - Connection to the browser endpoint
 * @returns Page tabs
 */
export async function listPageTabs(cdp: CDPConnection): Promise<PageTab[]> {
  void cdp;
  return Promise.reject(new Error('not implemented'));
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
  void tabs;
  void query;
  throw new Error('not implemented');
}
