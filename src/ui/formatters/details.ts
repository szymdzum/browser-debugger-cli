import type { NetworkRequest, ConsoleMessage } from '@/types';
import { OutputFormatter } from '@/ui/formatting.js';

/**
 * Format network request details for human-readable output
 */
export function formatNetworkDetails(request: NetworkRequest): string {
  const fmt = new OutputFormatter();

  fmt.text('Network Request Details').separator('━', 70);
  fmt.keyValueList(
    [
      ['Request ID', request.requestId],
      ['URL', request.url],
      ['Method', request.method],
      ['Status', request.status?.toString() ?? 'pending'],
      ['MIME Type', request.mimeType ?? 'N/A'],
    ],
    13
  );
  fmt.blank();

  if (request.requestHeaders) {
    fmt.text('Request Headers:').separator('━', 70);
    Object.entries(request.requestHeaders).forEach(([key, value]) => {
      fmt.text(`  ${key}: ${value}`);
    });
    fmt.blank();
  }

  if (request.requestBody) {
    fmt.text('Request Body:').separator('━', 70);
    fmt.text(request.requestBody);
    fmt.blank();
  }

  if (request.responseHeaders) {
    fmt.text('Response Headers:').separator('━', 70);
    Object.entries(request.responseHeaders).forEach(([key, value]) => {
      fmt.text(`  ${key}: ${value}`);
    });
    fmt.blank();
  }

  if (request.responseBody) {
    fmt.text('Response Body:').separator('━', 70);
    fmt.text(request.responseBody);
  }

  return fmt.build();
}

/**
 * Format console message details for human-readable output
 */
export function formatConsoleDetails(message: ConsoleMessage): string {
  const fmt = new OutputFormatter();

  fmt.text('Console Message Details').separator('━', 70);
  fmt.keyValueList(
    [
      ['Type', message.type],
      ['Timestamp', new Date(message.timestamp).toISOString()],
      ['Text', message.text],
    ],
    12
  );
  fmt.blank();

  if (message.args && message.args.length > 0) {
    fmt.text('Arguments:').separator('━', 70);
    message.args.forEach((arg, idx) => {
      fmt.text(`  [${idx}]: ${JSON.stringify(arg, null, 2)}`);
    });
  }

  return fmt.build();
}
