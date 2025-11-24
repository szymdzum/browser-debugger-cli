/**
 * Network list formatter for bdg network list command.
 *
 * Provides human-readable and JSON output formats for network requests
 * with support for filtering results display.
 */

import type { NetworkRequest } from '@/types.js';
import { getResourceTypeAbbr } from '@/ui/formatters/preview.js';
import { OutputFormatter, truncateUrl } from '@/ui/formatting.js';

export interface NetworkListOptions {
  json?: boolean;
  verbose?: boolean;
  last?: number;
  totalCount?: number;
  follow?: boolean;
}

interface JsonOutput {
  success: boolean;
  data: NetworkRequest[];
  count: number;
  totalCount: number;
  filtered: boolean;
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;
const SEPARATOR_WIDTH = 80;
const COLUMN_HEADER = '[ID]   STS METH TYP     SIZE  URL';

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

function formatStatus(status: number | undefined): string {
  if (status === undefined || status === 0) return 'PND';
  return `${status}`;
}

function formatRequestLine(request: NetworkRequest, verbose: boolean): string {
  const id = request.requestId.padEnd(4);
  const status = formatStatus(request.status).padEnd(3);
  const method = request.method.padEnd(4);
  const type = getResourceTypeAbbr(request.resourceType, request.mimeType);
  const size = formatSize(request.encodedDataLength).padStart(8);
  const urlMaxLength = verbose ? 120 : 50;
  const url = verbose ? request.url : truncateUrl(request.url, urlMaxLength);

  return `[${id}] ${status} ${method} ${type} ${size}  ${url}`;
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

  fmt.text(COLUMN_HEADER);
  fmt.separator('─', SEPARATOR_WIDTH);

  const verbose = options.verbose ?? false;
  for (const request of requests) {
    fmt.text(formatRequestLine(request, verbose));
  }

  return fmt.build();
}

function formatNetworkListJson(requests: NetworkRequest[], options: NetworkListOptions): string {
  const totalCount = options.totalCount ?? requests.length;

  const output: JsonOutput = {
    success: true,
    data: requests,
    count: requests.length,
    totalCount,
    filtered: requests.length !== totalCount,
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Format network requests for display.
 */
export function formatNetworkList(requests: NetworkRequest[], options: NetworkListOptions): string {
  return options.json
    ? formatNetworkListJson(requests, options)
    : formatNetworkListHuman(requests, options);
}
