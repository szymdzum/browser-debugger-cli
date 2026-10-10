/**
 * `network list --page` and `--sort`: which page's requests are listed, in
 * which order, and which `--last` window of them.
 */

import { InvalidArgumentError } from 'commander';

import { FILTER_PRESETS } from '@/telemetry/filterPresets.js';
import { currentNavigationOf, isPreviousPage } from '@/telemetry/pageScope.js';
import type { NetworkRequest } from '@/types.js';
import type { SortKey } from '@/ui/formatters/networkList.js';
import { findSimilar } from '@/utils/suggestions.js';

/** Requests of the page currently loaded, or of the whole session */
export type PageScope = 'current' | 'all';

export type { SortKey };

const PAGE_SCOPES: readonly PageScope[] = ['current', 'all'];
const SORT_KEYS: readonly SortKey[] = ['size', 'duration', 'start'];

/**
 * Commander parser for a value of a fixed list, case-insensitive.
 *
 * @param value - Raw option value
 * @param choices - Valid values
 * @param usage - What to write instead, e.g. `Use current or all`
 * @returns The value
 * @throws InvalidArgumentError (exit 81) with a did-you-mean
 */
function choiceOption<T extends string>(value: string, choices: readonly T[], usage: string): T {
  const normalized = value.trim().toLowerCase();
  const choice = choices.find((candidate) => candidate === normalized);
  if (choice) return choice;
  const similar = findSimilar(normalized, choices);
  throw new InvalidArgumentError(
    `${usage}${similar.length ? ` (did you mean ${similar[0]}?)` : ''}.`
  );
}

/**
 * Commander parser for `network list --page`.
 *
 * @param value - Raw option value
 * @returns Page scope
 * @throws InvalidArgumentError (exit 81) with a did-you-mean
 */
export function pageScopeOption(value: string): PageScope {
  return choiceOption(value, PAGE_SCOPES, 'Use current or all');
}

/**
 * Commander parser for `network list --sort`.
 *
 * @param value - Raw option value
 * @returns Sort key
 * @throws InvalidArgumentError (exit 81) with a did-you-mean
 */
export function sortKeyOption(value: string): SortKey {
  return choiceOption(value, SORT_KEYS, 'Use size, duration or start');
}

/**
 * Page scope without `--page`: the current page for presets whose matches
 * on earlier pages mislead (errors, failed, slow), else the whole session.
 *
 * @param preset - `--preset` name, if any
 * @returns Page scope
 */
export function defaultPageScope(preset: string | undefined): PageScope {
  return preset && FILTER_PRESETS[preset.toLowerCase()]?.page === 'current' ? 'current' : 'all';
}

/**
 * Keep the requests of the page currently loaded (`current`), counting
 * those of earlier pages and of another tab before a switch.
 *
 * @param requests - Requests matching the filters
 * @param scope - Page scope
 * @param currentNavigationId - The session's current navigation id (default: the latest among the requests)
 * @returns Requests kept and how many were hidden
 */
export function scopeToPage(
  requests: NetworkRequest[],
  scope: PageScope,
  currentNavigationId: number | undefined
): { requests: NetworkRequest[]; hidden: number } {
  if (scope === 'all') return { requests, hidden: 0 };
  const current = currentNavigationOf(requests, currentNavigationId);
  const kept = requests.filter((request) => !isPreviousPage(request, current));
  return { requests: kept, hidden: requests.length - kept.length };
}

/**
 * Order two requests by when they started, in Chrome's time when both have
 * it (precise), else in wall-clock time.
 *
 * @param a - Request
 * @param b - Request
 * @returns Negative when `a` started first
 */
function byStart(a: NetworkRequest, b: NetworkRequest): number {
  if (a.sentTime !== undefined && b.sentTime !== undefined) return a.sentTime - b.sentTime;
  return a.timestamp - b.timestamp;
}

/**
 * Value a descending sort orders by (requests without one go last).
 *
 * @param request - Request
 * @param key - `size` (bytes transferred) or `duration`
 * @returns Value, or -1 when unknown (pending)
 */
function descendingValue(request: NetworkRequest, key: 'size' | 'duration'): number {
  const value = key === 'size' ? request.encodedDataLength : request.duration;
  return value ?? -1;
}

/**
 * Order the requests and take the `--last` window: without `--sort` or
 * with `start`, the latest n by start; with `size` or `duration`, the n
 * largest or slowest, first.
 *
 * @param requests - Requests in capture order
 * @param sort - Sort key, if any
 * @param lastN - Window size (0 = all)
 * @returns Requests to list
 */
export function selectRequests(
  requests: NetworkRequest[],
  sort: SortKey | undefined,
  lastN: number
): NetworkRequest[] {
  if (sort === 'size' || sort === 'duration') {
    const sorted = [...requests].sort(
      (a, b) => descendingValue(b, sort) - descendingValue(a, sort)
    );
    return lastN === 0 ? sorted : sorted.slice(0, lastN);
  }
  const ordered = sort === 'start' ? [...requests].sort(byStart) : requests;
  return lastN === 0 ? ordered : ordered.slice(-lastN);
}
