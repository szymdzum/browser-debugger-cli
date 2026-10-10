/**
 * Network list formatter for bdg network list command.
 *
 * Provides human-readable and JSON output formats for network requests
 * with support for filtering results display.
 */

import { summarizeBlockedCookies } from '@/telemetry/blockedCookies.js';
import { currentNavigationOf } from '@/telemetry/pageScope.js';
import type { NetworkRequest } from '@/types.js';
import { getResourceTypeAbbr } from '@/ui/formatters/preview.js';
import { getRequestState } from '@/ui/formatters/requestStatus.js';
import { OutputFormatter, truncateUrl } from '@/ui/formatting.js';
import {
  COOKIE_BLOCKED_MARK,
  earlierPagesHiddenNote,
  networkEvictedNote,
  type NetworkEvictionCounts,
} from '@/ui/messages/networkMessages.js';

export interface NetworkListOptions {
  verbose?: boolean;
  /** Start of the current page, which the START column counts from ({@link pageStartOf}) */
  pageStart?: PageStart;
  last?: number;
  totalCount?: number;
  /** Requests matching the filters, before --last (defaults to totalCount) */
  filteredCount?: number;
  /** Requests dropped and bodies evicted at the session's capture limits */
  evictions?: NetworkEvictionCounts;
  /** Order of the list (`--sort`); default: capture order */
  sort?: SortKey;
  /** Requests of earlier pages matching the filters that `--page current` left out */
  hiddenEarlierPages?: number;
}

/** Orders of `network list --sort`: largest, slowest first, or by start time */
export type SortKey = 'size' | 'duration' | 'start';

/**
 * When the current page started loading: the request of its document, in
 * Chrome's monotonic time (`sentTime`, seconds) and wall-clock time
 * (`timestamp`, epoch ms).
 */
export type PageStart = Pick<NetworkRequest, 'sentTime' | 'timestamp'>;

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const SEPARATOR_WIDTH = 80;

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || bytes === 0) return '-';

  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  const formatted = size < 10 ? size.toFixed(1) : Math.round(size).toString();
  return `${formatted} ${SIZE_UNITS[unitIndex]}`;
}

function formatStatus(request: NetworkRequest): string {
  const state = getRequestState(request);
  if (state === 'pending') return 'PND';
  return state === 'failed' ? 'ERR' : `${request.status}`;
}

/**
 * Format a request duration for the TIME column.
 *
 * @param ms - Duration in milliseconds (undefined while pending)
 * @returns e.g. "85ms", "1.2s", or "-"
 */
function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return '-';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The start of the current page: the earliest document request of the
 * latest navigation among the requests (its earliest request when its
 * document was not captured).
 *
 * @param requests - All captured requests (before filters, so the document is among them)
 * @returns Its times, or undefined when there are no requests
 */
export function pageStartOf(requests: NetworkRequest[]): PageStart | undefined {
  const current = currentNavigationOf(requests);
  const page = requests.filter((r) => r.navigationId === current);
  const documents = page.filter((r) => r.resourceType === 'Document');
  const first = (documents.length > 0 ? documents : page).reduce<NetworkRequest | undefined>(
    (earliest, r) => (earliest === undefined || r.timestamp < earliest.timestamp ? r : earliest),
    undefined
  );
  return (
    first && {
      timestamp: first.timestamp,
      ...(first.sentTime !== undefined && { sentTime: first.sentTime }),
    }
  );
}

/**
 * Milliseconds from the page start to a request's start, in Chrome's time
 * when both have it (precise), else in wall-clock time.
 *
 * @param request - Request
 * @param pageStart - Start of the current page
 * @returns Offset (negative for requests of earlier pages)
 */
function startOffsetMs(request: NetworkRequest, pageStart: PageStart): number {
  if (request.sentTime !== undefined && pageStart.sentTime !== undefined) {
    return (request.sentTime - pageStart.sentTime) * 1000;
  }
  return request.timestamp - pageStart.timestamp;
}

/**
 * Format a request's start for the START column, relative to the current
 * page's start: tenths of a second up to 100 s, then whole seconds, then
 * minutes.
 *
 * @param request - Request
 * @param pageStart - Start of the current page (none: `-`)
 * @returns e.g. "+0.0s", "+1.2s", "+250s", "+17m", "-35.2s" (earlier page)
 */
export function formatStartOffset(
  request: NetworkRequest,
  pageStart: PageStart | undefined
): string {
  if (!pageStart) return '-';
  const ms = startOffsetMs(request, pageStart);
  const seconds = Math.abs(ms) / 1000;
  const sign = ms < -50 ? '-' : '+';
  if (seconds < 99.95) return `${sign}${seconds.toFixed(1)}s`;
  if (seconds < 999.5) return `${sign}${Math.round(seconds)}s`;
  return `${sign}${Math.floor(seconds / 60)}m`;
}

/** Widths of the columns whose content varies in length */
interface ColumnWidths {
  /** Bracketed request id */
  id: number;
  /** HTTP method (`OPTIONS` is longer than the usual 4) */
  method: number;
}

/**
 * Column header aligned to the widest request id and method in the list.
 *
 * @param widths - Column widths
 * @returns Header line
 */
function formatColumnHeader(widths: ColumnWidths): string {
  return `${'[ID]'.padEnd(widths.id)} ${'START'.padStart(6)} STS ${'METH'.padEnd(widths.method)} TYP ${'SIZE'.padStart(8)} ${'TIME'.padStart(6)}  URL`;
}

/**
 * Format one request as a table row.
 *
 * @param request - Network request
 * @param options - Show full URLs (`verbose`), the page start for START
 * @param widths - Column widths (ids and methods vary in length)
 * @returns Row text
 */
function formatRequestLine(
  request: NetworkRequest,
  options: Pick<NetworkListOptions, 'verbose' | 'pageStart'>,
  widths: ColumnWidths
): string {
  const id = `[${request.requestId}]`.padEnd(widths.id);
  const start = formatStartOffset(request, options.pageStart).padStart(6);
  const status = formatStatus(request).padEnd(3);
  const method = request.method.padEnd(widths.method);
  const type = getResourceTypeAbbr(request.resourceType, request.mimeType).padEnd(3);
  const size = formatSize(request.encodedDataLength).padStart(8);
  const time = formatDuration(request.duration).padStart(6);
  const url = options.verbose ? request.url : truncateUrl(request.url, 50);
  const blocked = request.blockedCookieSummary ?? summarizeBlockedCookies(request);
  const mark = blocked ? `  ${COOKIE_BLOCKED_MARK}` : '';

  return `${id} ${start} ${status} ${method} ${type} ${size} ${time}  ${url}${mark}`;
}

/**
 * Column widths fitting the rows.
 *
 * @param requests - Rows
 * @param minIdWidth - Narrowest id column
 * @returns Widths
 */
function columnWidths(requests: NetworkRequest[], minIdWidth: number): ColumnWidths {
  return {
    id: Math.max(minIdWidth, ...requests.map((r) => r.requestId.length + 2)),
    method: Math.max('METH'.length, ...requests.map((r) => r.method.length)),
  };
}

/** How a cut window and the order read for sorts with the largest values first */
const DESCENDING_WORDS: Partial<Record<SortKey, string>> = {
  size: 'largest',
  duration: 'slowest',
};

/**
 * Header line with how many requests are shown, in which order.
 *
 * @param showingCount - Requests listed
 * @param filteredCount - Requests matching the filters
 * @param totalCount - Requests captured
 * @param sort - Order of the list, if sorted
 * @returns e.g. "NETWORK REQUESTS (last 10 of 42)", "NETWORK REQUESTS (21 matching, 240 in all)",
 *   "NETWORK REQUESTS (5 largest of 42)" or "NETWORK REQUESTS (42, slowest first)"
 */
function buildHeader(
  showingCount: number,
  filteredCount: number,
  totalCount: number,
  sort?: SortKey
): string {
  const descending = sort && DESCENDING_WORDS[sort];
  const cut = filteredCount > showingCount;
  const window = descending ? `${showingCount} ${descending} of ` : `last ${showingCount} of `;
  const shown = cut ? window : '';
  const order = descending && !cut ? `, ${descending} first` : '';
  if (filteredCount < totalCount) {
    return `NETWORK REQUESTS (${shown}${filteredCount} matching, ${totalCount} in all${order})`;
  }
  return `NETWORK REQUESTS (${shown}${totalCount}${order})`;
}

function formatNetworkListHuman(requests: NetworkRequest[], options: NetworkListOptions): string {
  const fmt = new OutputFormatter();
  const totalCount = options.totalCount ?? requests.length;
  const header = buildHeader(
    requests.length,
    options.filteredCount ?? totalCount,
    totalCount,
    options.sort
  );
  const hiddenNote =
    options.hiddenEarlierPages && earlierPagesHiddenNote(options.hiddenEarlierPages);

  fmt.text(header);
  fmt.separator('─', SEPARATOR_WIDTH);
  const evictedNote = options.evictions && networkEvictedNote(options.evictions);
  if (evictedNote) fmt.text(evictedNote);

  if (requests.length === 0) {
    fmt.text('No matching requests found.');
    if (hiddenNote) fmt.text(hiddenNote);
    return fmt.build();
  }

  const widths = columnWidths(requests, '[ID]'.length);
  fmt.text(formatColumnHeader(widths));
  fmt.separator('─', SEPARATOR_WIDTH);

  for (const request of requests) {
    fmt.text(formatRequestLine(request, options, widths));
  }
  if (hiddenNote) fmt.text(hiddenNote);

  return fmt.build();
}

/** Narrowest id column of the stream (ids of later rows may be longer) */
const FOLLOW_ID_WIDTH = 14;

/**
 * Rows of the network stream: requests that finished since the last poll,
 * with the column header the first time (the stream banner is on stderr),
 * after the dropped/evicted note when the counts changed.
 *
 * @param requests - Newly finished requests
 * @param options - `header` the first time; `verbose` for full URLs; the page start for
 *   START; `evictions` only when the session's counts changed since the last poll
 * @returns Text to print (empty when there is nothing new)
 */
export function formatNetworkFollowRows(
  requests: NetworkRequest[],
  options: {
    header?: boolean;
    verbose?: boolean;
    pageStart?: PageStart;
    evictions?: NetworkEvictionCounts;
  } = {}
): string {
  const fmt = new OutputFormatter();
  const widths = columnWidths(requests, FOLLOW_ID_WIDTH);
  const evictedNote = options.evictions && networkEvictedNote(options.evictions);
  if (evictedNote) fmt.text(evictedNote);
  if (options.header) {
    fmt.text(formatColumnHeader(widths));
    fmt.separator('─', SEPARATOR_WIDTH);
  }
  for (const request of requests) fmt.text(formatRequestLine(request, options, widths));
  return fmt.build();
}

/**
 * Format network requests for display.
 */
export function formatNetworkList(requests: NetworkRequest[], options: NetworkListOptions): string {
  return formatNetworkListHuman(requests, options);
}
