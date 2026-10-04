/**
 * Network list formatter for bdg network list command.
 *
 * Provides human-readable and JSON output formats for network requests
 * with support for filtering results display.
 */

import type { NetworkRequest } from '@/types.js';
import { getResourceTypeAbbr } from '@/ui/formatters/preview.js';
import { getRequestState } from '@/ui/formatters/requestStatus.js';
import { OutputFormatter, truncateUrl } from '@/ui/formatting.js';

export interface NetworkListOptions {
  verbose?: boolean;
  last?: number;
  totalCount?: number;
  follow?: boolean;
}

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
 * Column header aligned to the widest request id in the list.
 *
 * @param idWidth - Width of the bracketed id column
 * @returns Header line
 */
function formatColumnHeader(idWidth: number): string {
  return `${'[ID]'.padEnd(idWidth)} STS METH TYP ${'SIZE'.padStart(8)} ${'TIME'.padStart(6)}  URL`;
}

/**
 * Format one request as a table row.
 *
 * @param request - Network request
 * @param verbose - Show full URLs
 * @param idWidth - Width of the bracketed id column (ids vary in length)
 * @returns Row text
 */
function formatRequestLine(request: NetworkRequest, verbose: boolean, idWidth: number): string {
  const id = `[${request.requestId}]`.padEnd(idWidth);
  const status = formatStatus(request).padEnd(3);
  const method = request.method.padEnd(4);
  const type = getResourceTypeAbbr(request.resourceType, request.mimeType).padEnd(3);
  const size = formatSize(request.encodedDataLength).padStart(8);
  const time = formatDuration(request.duration).padStart(6);
  const urlMaxLength = verbose ? 120 : 50;
  const url = verbose ? request.url : truncateUrl(request.url, urlMaxLength);

  return `${id} ${status} ${method} ${type} ${size} ${time}  ${url}`;
}

function buildHeader(
  options: NetworkListOptions,
  showingCount: number,
  totalCount: number
): string {
  if (options.follow) {
    return `NETWORK REQUESTS (showing ${showingCount} of ${totalCount})`;
  }

  const lastLimit = options.last ?? 0;
  if (lastLimit > 0 && totalCount > showingCount) {
    return `NETWORK REQUESTS (last ${showingCount} of ${totalCount})`;
  }

  return `NETWORK REQUESTS (${totalCount})`;
}

function formatNetworkListHuman(requests: NetworkRequest[], options: NetworkListOptions): string {
  const fmt = new OutputFormatter();
  const totalCount = options.totalCount ?? requests.length;
  const header = buildHeader(options, requests.length, totalCount);

  fmt.text(header);
  fmt.separator('─', SEPARATOR_WIDTH);

  if (requests.length === 0) {
    fmt.text('No matching requests found.');
    return fmt.build();
  }

  const idWidth = Math.max('[ID]'.length, ...requests.map((r) => r.requestId.length + 2));
  fmt.text(formatColumnHeader(idWidth));
  fmt.separator('─', SEPARATOR_WIDTH);

  const verbose = options.verbose ?? false;
  for (const request of requests) {
    fmt.text(formatRequestLine(request, verbose, idWidth));
  }

  return fmt.build();
}

/**
 * Format network requests for display.
 */
export function formatNetworkList(requests: NetworkRequest[], options: NetworkListOptions): string {
  return formatNetworkListHuman(requests, options);
}
