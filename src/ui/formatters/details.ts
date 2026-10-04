import type { NetworkRequest, ConsoleMessage, WebSocketFrame } from '@/types.js';
import { formatRequestStatus } from '@/ui/formatters/requestStatus.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { truncateByLength } from '@/utils/strings.js';

/** Characters of each WebSocket message shown in human output (`--json` has all) */
const MESSAGE_PREVIEW_LENGTH = 200;

/** WebSocket opcode of binary messages */
const BINARY_OPCODE = 2;

/**
 * Format one WebSocket message as a single line: direction, time, payload.
 *
 * @param frame - Captured frame
 * @returns Line like `↑ 12:00:00.123  hello` (`[truncated]` when the capture was cut)
 */
function formatWebSocketMessage(frame: WebSocketFrame): string {
  const arrow = frame.direction === 'sent' ? '↑' : '↓';
  const time = new Date(frame.timestamp).toISOString().slice(11, 23);
  const truncated = frame.truncatedFrom === undefined ? '' : ' [truncated]';
  const payload =
    frame.opcode === BINARY_OPCODE
      ? `(binary, ${Buffer.byteLength(frame.payloadData, 'base64')} bytes captured)`
      : truncateByLength(frame.payloadData.replace(/\s+/g, ' '), MESSAGE_PREVIEW_LENGTH);
  return `  ${arrow} ${time}  ${payload}${truncated}`;
}

/**
 * Add the messages of a WebSocket connection.
 *
 * @param fmt - Formatter to add to
 * @param webSocket - Connection messages and lifecycle
 */
function addWebSocketMessages(
  fmt: OutputFormatter,
  webSocket: NonNullable<NetworkRequest['webSocket']>
): void {
  const state = webSocket.closedTime
    ? `closed at ${new Date(webSocket.closedTime).toISOString()}`
    : 'open';
  fmt.blank();
  fmt.text(`WebSocket Messages (${webSocket.frames.length}, ${state}):`).separator('━', 70);
  webSocket.frames.forEach((frame) => fmt.text(formatWebSocketMessage(frame)));
}

/**
 * Format network request details for human-readable output
 */
export function formatNetworkDetails(request: NetworkRequest): string {
  const fmt = new OutputFormatter();

  fmt.text('Network Request Details').separator('━', 70);
  fmt.keyValueList([
    ['Request ID', request.requestId],
    ['URL', request.url],
    ['Method', request.method],
    ['Status', formatRequestStatus(request)],
    ['Resource Type', request.resourceType ?? 'N/A'],
    ['MIME Type', request.mimeType ?? 'N/A'],
  ]);
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
    fmt.text(
      request.responseBodyBase64
        ? `(binary, ${request.decodedBodyLength ?? 0} bytes; base64 in --json and HAR export)`
        : request.responseBody
    );
  }

  if (request.webSocket) {
    addWebSocketMessages(fmt, request.webSocket);
  }

  return fmt.build();
}

/**
 * Format console message details for human-readable output
 */
export function formatConsoleDetails(message: ConsoleMessage): string {
  const fmt = new OutputFormatter();

  fmt.text('Console Message Details').separator('━', 70);
  fmt.keyValueList([
    ['Type', message.type],
    ['Timestamp', new Date(message.timestamp).toISOString()],
    ['Text', message.text],
  ]);
  fmt.blank();

  if (message.args && message.args.length > 0) {
    fmt.text('Arguments:').separator('━', 70);
    message.args.forEach((arg, idx) => {
      fmt.text(`  [${idx}]: ${JSON.stringify(arg, null, 2)}`);
    });
  }

  return fmt.build();
}
