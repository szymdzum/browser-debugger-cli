/**
 * Network Headers Formatter
 *
 * Formats network request and response headers for human-readable display.
 */

import type { SessionNetworkHeadersData } from '@/ipc/protocol/commands.js';
import { formatRequestStatus } from '@/ui/formatters/requestStatus.js';
import { OutputFormatter } from '@/ui/formatting.js';

/**
 * Format network request headers for display.
 *
 * @param data - Network headers data from the session
 * @returns Formatted string for console output
 */
export function formatNetworkHeaders(data: SessionNetworkHeadersData): string {
  const fmt = new OutputFormatter();

  fmt.text('Network Request Headers').separator('━', 60).blank();

  fmt.text('URL:').text(`  ${data.url}`).blank();
  fmt.text(`Status: ${requestStatusLine(data)}`).blank();

  if (Object.keys(data.responseHeaders).length > 0) {
    fmt.text('Response Headers:');
    formatHeaderSection(fmt, data.responseHeaders);
    fmt.blank();
  }

  if (Object.keys(data.requestHeaders).length > 0) {
    fmt.text('Request Headers:');
    formatHeaderSection(fmt, data.requestHeaders);
    fmt.blank();
  }

  if (
    Object.keys(data.responseHeaders).length === 0 &&
    Object.keys(data.requestHeaders).length === 0
  ) {
    fmt.text('No headers found').blank();
  }

  fmt.text(`Request ID: ${data.requestId}`);

  return fmt.build();
}

/**
 * Format a section of headers with consistent formatting.
 *
 * Repeated headers (CDP joins e.g. multiple `Set-Cookie` values with newlines)
 * are printed one per line.
 *
 * @param fmt - Output formatter instance
 * @param headers - Headers to format
 */
function formatHeaderSection(fmt: OutputFormatter, headers: Record<string, string>): void {
  const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  const keyWidth = Math.max(...entries.map(([k]) => k.length)) + 4;

  entries.forEach(([key, value]) => {
    value.split('\n').forEach((line) => fmt.keyValue(`  ${key}`, line, keyWidth));
  });
}

/**
 * Status line of a request: method, HTTP status and status text, or how it failed.
 *
 * @param data - Network headers data
 * @returns e.g. `GET 404 Not Found`, `GET FAILED (net::ERR_NAME_NOT_RESOLVED)`, `GET pending`
 */
function requestStatusLine(data: SessionNetworkHeadersData): string {
  const status = formatRequestStatus(data);
  const text = data.statusText && /^\d+$/.test(status) ? ` ${data.statusText}` : '';
  return [data.method, `${status}${text}`].filter(Boolean).join(' ');
}
