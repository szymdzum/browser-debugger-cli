import type { NetworkRequest, ConsoleMessage } from '@/types';

/**
 * Format network request details for human-readable output
 */
export function formatNetworkDetails(request: NetworkRequest): string {
  const lines: string[] = [];

  lines.push('Network Request Details');
  lines.push('━'.repeat(70));
  lines.push(`Request ID:  ${request.requestId}`);
  lines.push(`URL:         ${request.url}`);
  lines.push(`Method:      ${request.method}`);
  lines.push(`Status:      ${request.status || 'pending'}`);
  lines.push(`MIME Type:   ${request.mimeType || 'N/A'}`);
  lines.push('');

  if (request.requestHeaders) {
    lines.push('Request Headers:');
    lines.push('━'.repeat(70));
    Object.entries(request.requestHeaders).forEach(([key, value]) => {
      lines.push(`  ${key}: ${value}`);
    });
    lines.push('');
  }

  if (request.requestBody) {
    lines.push('Request Body:');
    lines.push('━'.repeat(70));
    lines.push(request.requestBody);
    lines.push('');
  }

  if (request.responseHeaders) {
    lines.push('Response Headers:');
    lines.push('━'.repeat(70));
    Object.entries(request.responseHeaders).forEach(([key, value]) => {
      lines.push(`  ${key}: ${value}`);
    });
    lines.push('');
  }

  if (request.responseBody) {
    lines.push('Response Body:');
    lines.push('━'.repeat(70));
    lines.push(request.responseBody);
  }

  return lines.join('\n');
}

/**
 * Format console message details for human-readable output
 */
export function formatConsoleDetails(message: ConsoleMessage): string {
  const lines: string[] = [];

  lines.push('Console Message Details');
  lines.push('━'.repeat(70));
  lines.push(`Type:       ${message.type}`);
  lines.push(`Timestamp:  ${new Date(message.timestamp).toISOString()}`);
  lines.push(`Text:       ${message.text}`);
  lines.push('');

  if (message.args && message.args.length > 0) {
    lines.push('Arguments:');
    lines.push('━'.repeat(70));
    message.args.forEach((arg, idx) => {
      lines.push(`  [${idx}]: ${JSON.stringify(arg, null, 2)}`);
    });
  }

  return lines.join('\n');
}
