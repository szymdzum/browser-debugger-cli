/**
 * Network Headers Formatter
 *
 * Formats network request and response headers for human-readable display.
 */

import type { WorkerNetworkHeadersData } from '@/ipc/protocol/commands.js';
import { OutputFormatter } from '@/ui/formatting.js';

/**
 * Format network request headers for display.
 *
 * @param data - Network headers data from worker
 * @returns Formatted string for console output
 */
export function formatNetworkHeaders(data: WorkerNetworkHeadersData): string {
  const fmt = new OutputFormatter();

  fmt.text('Network Request Headers').separator('━', 60).blank();

  fmt.text('URL:').text(`  ${data.url}`).blank();

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
 * @param fmt - Output formatter instance
 * @param headers - Headers to format
 */
function formatHeaderSection(fmt: OutputFormatter, headers: Record<string, string>): void {
  const entries = Object.entries(headers).sort(([a], [b]) => a.localeCompare(b));
  const maxKeyLength = Math.max(...entries.map(([k]) => k.length));

  entries.forEach(([key, value]) => {
    fmt.keyValue(`  ${key}:`, value, maxKeyLength + 4);
  });
}
