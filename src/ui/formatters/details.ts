import { skippedBodyReason } from '@/telemetry/network.js';
import type { NetworkRequest, ConsoleMessage, WebSocketFrame } from '@/types.js';
import { formatFramePosition, formatTimestamp } from '@/ui/formatters/console/shared.js';
import { formatRequestStatus } from '@/ui/formatters/requestStatus.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { sessionCommand } from '@/ui/messages/sessionCommand.js';
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
  const time = formatTimestamp(frame.timestamp);
  const truncated = frame.truncatedFrom === undefined ? '' : ' [truncated]';
  const payload =
    frame.opcode === BINARY_OPCODE
      ? binaryMessagePreview(frame.payloadData)
      : textPreview(frame.payloadData);
  return `  ${arrow} ${time}  ${payload}${truncated}`;
}

/**
 * A message payload on one line, shortened to {@link MESSAGE_PREVIEW_LENGTH}.
 *
 * @param text - Payload text
 * @returns Preview
 */
function textPreview(text: string): string {
  return truncateByLength(text.replace(/\s+/g, ' '), MESSAGE_PREVIEW_LENGTH);
}

/**
 * Describe a binary message, with its text when it is valid UTF-8 without
 * control characters (many protocols send JSON or text in binary frames).
 *
 * @param base64 - Payload as captured (base64)
 * @returns e.g. `(binary, 42 bytes) {"op":"ping"}` or `(binary, 42 bytes captured)`
 */
function binaryMessagePreview(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  const text = readableText(bytes);
  return text === undefined
    ? `(binary, ${bytes.length} bytes captured)`
    : `(binary, ${bytes.length} bytes) ${textPreview(text)}`;
}

/**
 * The bytes as text, if they are valid UTF-8 and printable.
 *
 * @param bytes - Raw bytes
 * @returns Text, or undefined for binary data
 */
function readableText(bytes: Buffer): string | undefined {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  const printable = (char: string): boolean => {
    const code = char.charCodeAt(0);
    return (code >= 0x20 && code !== 0x7f) || char === '\t' || char === '\n' || char === '\r';
  };
  return text.length > 0 && Array.from(text).every(printable) ? text : undefined;
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

/** Characters of a text body shown in human output (`--json` has all of it) */
const BODY_PREVIEW_LENGTH = 20000;

/**
 * Format a byte count for humans.
 *
 * @param bytes - Byte count
 * @returns e.g. "512 B", "12.3 KB"
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Summary rows of a request: identity, outcome, timing and size.
 *
 * @param request - Captured request
 * @returns Label/value rows
 */
function requestSummaryRows(request: NetworkRequest): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['Request ID', request.requestId],
    ['URL', request.url],
    ['Method', request.method],
    ['Status', formatRequestStatus(request)],
    ['Resource Type', request.resourceType ?? 'N/A'],
    ['MIME Type', request.mimeType ?? 'N/A'],
    ['Started', formatTimestamp(request.timestamp)],
    ['Duration', request.duration === undefined ? 'pending' : `${Math.round(request.duration)} ms`],
  ];
  if (request.encodedDataLength !== undefined) {
    const decoded = request.decodedBodyLength;
    const sizes = [`${formatBytes(request.encodedDataLength)} transferred`];
    if (decoded !== undefined) sizes.push(`${formatBytes(decoded)} body`);
    rows.push(['Size', sizes.join(', ')]);
  }
  if (request.fromCache) rows.push(['From Cache', 'yes']);
  if (request.serverIPAddress) rows.push(['Remote Address', request.serverIPAddress]);
  if (request.blockedReason) rows.push(['Blocked', request.blockedReason]);
  return rows;
}

/**
 * Add a header block.
 *
 * @param fmt - Formatter
 * @param title - Block title
 * @param headers - Headers to list
 */
function addHeaders(fmt: OutputFormatter, title: string, headers: Record<string, string>): void {
  fmt.text(title).separator('━', 70);
  Object.entries(headers).forEach(([key, value]) => fmt.text(`  ${key}: ${value}`));
  fmt.blank();
}

/**
 * Describe a response body for humans: binary and skipped bodies are
 * summarized, long text is cut (the JSON output has everything).
 *
 * @param request - Captured request with a body
 * @returns Body text
 */
function describeResponseBody(request: NetworkRequest & { responseBody: string }): string {
  const skipped = skippedBodyReason(request.responseBody);
  if (skipped !== undefined) return `(not captured: ${skipped})`;
  if (request.responseBodyBase64) {
    return `(binary, ${request.decodedBodyLength ?? 0} bytes; base64 in --json and HAR export)`;
  }
  const body = request.responseBody;
  if (body.length <= BODY_PREVIEW_LENGTH) return body;
  return `${body.slice(0, BODY_PREVIEW_LENGTH)}\n… ${body.length - BODY_PREVIEW_LENGTH} more characters (full body: ${sessionCommand(`bdg details network ${request.requestId} --json`)})`;
}

/**
 * Format network request details for human-readable output.
 *
 * @param request - Captured request
 * @returns Formatted details
 */
export function formatNetworkDetails(request: NetworkRequest): string {
  const fmt = new OutputFormatter();

  fmt.text('Network Request Details').separator('━', 70);
  fmt.keyValueList(requestSummaryRows(request));
  fmt.blank();

  if (request.requestHeaders) addHeaders(fmt, 'Request Headers:', request.requestHeaders);
  if (request.requestBody) {
    fmt.text('Request Body:').separator('━', 70);
    fmt.text(request.requestBody);
    fmt.blank();
  }
  if (request.responseHeaders) addHeaders(fmt, 'Response Headers:', request.responseHeaders);
  if (request.bodyNotCaptured) {
    fmt.text('Response Body:').separator('━', 70);
    fmt.text(`(not captured: ${request.bodyNotCaptured})`);
  } else if (request.responseBody) {
    fmt.text('Response Body:').separator('━', 70);
    fmt.text(describeResponseBody({ ...request, responseBody: request.responseBody }));
  }
  if (request.webSocket) addWebSocketMessages(fmt, request.webSocket);

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
    ['Time', formatTimestamp(message.timestamp)],
    ...(message.source ? ([['Source', message.source]] as Array<[string, string]>) : []),
    ['Text', message.text],
  ]);
  fmt.blank();

  if (message.stackTrace && message.stackTrace.length > 0) {
    fmt.text('Stack Trace:').separator('━', 70);
    message.stackTrace.forEach((frame) => {
      const name = frame.functionName?.length ? frame.functionName : '(anonymous)';
      fmt.text(`  at ${name} (${formatFramePosition(frame)})`);
    });
    fmt.blank();
  }

  if (message.args && message.args.length > 0) {
    fmt.text('Arguments:').separator('━', 70);
    message.args.forEach((arg, idx) => {
      fmt.text(`  [${idx}]: ${JSON.stringify(arg, null, 2)}`);
    });
  }

  return fmt.build();
}
