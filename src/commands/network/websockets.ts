/**
 * Network WebSockets command - displays WebSocket connections and message frames.
 */

import { Option, type Command } from 'commander';

import { runCommand } from '@/commands/shared/CommandRunner.js';
import { jsonOption } from '@/commands/shared/commonOptions.js';
import type { BaseOptions } from '@/commands/shared/optionTypes.js';
import { positiveIntRule } from '@/commands/shared/validation.js';
import { getWebSocketConnections } from '@/ipc/client.js';
import { validateIPCResponse } from '@/ipc/index.js';
import type { WebSocketConnection, WebSocketFrame } from '@/types.js';
import { OutputFormatter } from '@/ui/formatting.js';
import { VERSION } from '@/utils/version.js';

const MIN_FRAMES = 0;
const MAX_FRAMES = 1000;
const DEFAULT_FRAMES = 10;
const PREVIEW_LENGTH_NORMAL = 500;
const PREVIEW_LENGTH_VERBOSE = 5000;

interface WebSocketsCommandOptions extends BaseOptions {
  last?: string;
  verbose?: boolean;
}

interface WebSocketsResultData {
  version: string;
  success: boolean;
  connections: WebSocketConnection[];
}

const framesOption = new Option(
  '--last <n>',
  `Show last N frames per connection (0 = all, default: ${DEFAULT_FRAMES})`
).default(String(DEFAULT_FRAMES));

/**
 * Get opcode display name.
 *
 * @param opcode - WebSocket opcode
 * @returns Human-readable opcode name
 */
function getOpcodeName(opcode: number): string {
  switch (opcode) {
    case 1:
      return 'TEXT';
    case 2:
      return 'BINARY';
    default:
      return `OPCODE_${opcode}`;
  }
}

/**
 * Truncate payload data to specified length.
 *
 * @param data - Payload data
 * @param maxLength - Maximum length before truncation
 * @returns Truncated payload with ellipsis if needed
 */
function truncatePayload(data: string, maxLength: number): string {
  return data.length > maxLength ? `${data.substring(0, maxLength)}...` : data;
}

/**
 * Format frame direction for display.
 *
 * @param direction - Frame direction
 * @returns Formatted direction string
 */
function formatDirection(direction: 'sent' | 'received'): string {
  return direction === 'sent' ? 'SENT' : 'RECV';
}

/**
 * Format a single WebSocket frame for display.
 *
 * @param frame - WebSocket frame
 * @param frameIdx - Frame index
 * @param verbose - Whether to show verbose output
 * @param fmt - Output formatter
 */
function formatFrame(
  frame: WebSocketFrame,
  frameIdx: number,
  verbose: boolean,
  fmt: OutputFormatter
): void {
  const direction = formatDirection(frame.direction);
  const time = new Date(frame.timestamp).toISOString();
  const opcodeName = getOpcodeName(frame.opcode);

  fmt.text(`      [${frameIdx}] ${direction} ${opcodeName} @ ${time}`);

  const previewLength = verbose ? PREVIEW_LENGTH_VERBOSE : PREVIEW_LENGTH_NORMAL;
  const payloadData = frame.payloadData ?? '[No payload data]';
  const preview = truncatePayload(payloadData, previewLength);
  fmt.text(`          ${preview}`);
}

/**
 * Format a single WebSocket connection for display.
 *
 * @param conn - WebSocket connection
 * @param idx - Connection index
 * @param framesPerConnection - Number of frames to display
 * @param options - Command options
 * @param fmt - Output formatter
 */
function formatConnection(
  conn: WebSocketConnection,
  idx: number,
  framesPerConnection: number,
  options: WebSocketsCommandOptions,
  fmt: OutputFormatter
): void {
  fmt.text(`[${idx}] ${conn.url}`);
  fmt.text(`    Created: ${new Date(conn.timestamp).toISOString()}`);
  fmt.text(`    Status: ${conn.status ?? 'N/A'}`);
  fmt.text(`    Total Frames: ${conn.frames.length}`);

  if (conn.closedTime) {
    fmt.text(`    Closed: ${new Date(conn.closedTime).toISOString()}`);
  }

  if (conn.errorMessage) {
    fmt.text(`    Error: ${conn.errorMessage}`);
  }

  const framesToShow =
    framesPerConnection === 0 ? conn.frames : conn.frames.slice(-framesPerConnection);

  if (framesToShow.length > 0) {
    fmt.blank();
    fmt.text(`    Recent Frames (showing ${framesToShow.length} of ${conn.frames.length}):`);

    framesToShow.forEach((frame, frameIdx) => {
      formatFrame(frame, frameIdx, options.verbose ?? false, fmt);
    });
  }
}

/**
 * Format WebSocket connections for human display.
 *
 * @param connections - WebSocket connections
 * @param options - Command options
 * @returns Formatted output
 */
function formatWebSocketConnectionsHuman(
  connections: WebSocketConnection[],
  options: WebSocketsCommandOptions
): string {
  const fmt = new OutputFormatter();
  const framesPerConnection = positiveIntRule({
    min: MIN_FRAMES,
    max: MAX_FRAMES,
    allowZeroForAll: true,
  }).validate(options.last);

  if (connections.length === 0) {
    fmt.text('No WebSocket connections found.');
    fmt.blank();
    fmt.text('Tip: WebSocket connections are captured when the session is active.');
    return fmt.build();
  }

  fmt.text(`WebSocket Connections (${connections.length})`);
  fmt.separator('─', 80);

  connections.forEach((conn, idx) => {
    formatConnection(conn, idx, framesPerConnection, options, fmt);
    if (idx < connections.length - 1) {
      fmt.blank();
    }
  });

  return fmt.build();
}

/**
 * Register the websockets command.
 *
 * @param networkCmd - Network command group
 */
export function registerWebSocketsCommand(networkCmd: Command): void {
  networkCmd
    .command('websockets')
    .description('Show WebSocket connections and message frames')
    .addOption(framesOption)
    .addOption(
      new Option('-v, --verbose', 'Show full message content (longer previews)').default(false)
    )
    .addOption(jsonOption())
    .action(async (options: WebSocketsCommandOptions) => {
      await runCommand(
        async () => {
          const response = await getWebSocketConnections();
          validateIPCResponse(response);

          const connections = response.data?.connections ?? [];

          return {
            success: true,
            data: {
              version: VERSION,
              success: true,
              connections,
            },
          };
        },
        options,
        (data: WebSocketsResultData) => formatWebSocketConnectionsHuman(data.connections, options)
      );
    });
}
