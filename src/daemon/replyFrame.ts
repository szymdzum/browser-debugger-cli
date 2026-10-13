/**
 * The lines the daemon writes for a response: capped in size, and error replies.
 */

import { replyTooLargeError } from '@/errors/messages.js';
import { MAX_JSONL_BUFFER_SIZE } from '@/constants.js';
import type { IPCErrorFrame } from '@/ipc/session/index.js';
import { toJSONLFrame } from '@/ipc/transport/jsonl.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Error reply to a frame that cannot be routed.
 *
 * @param frame - The parsed frame, if it parsed (its `sessionId` is echoed when it is a string)
 * @param error - What is wrong with it
 * @param suggestion - How to recover, if there is a way
 * @param exitCode - Exit code the client ends with
 * @returns Error frame the client matches by session id
 */
export function errorFrame(
  frame: unknown,
  error: string,
  suggestion?: string,
  exitCode: number = EXIT_CODES.SOFTWARE_ERROR
): IPCErrorFrame {
  const id =
    typeof frame === 'object' && frame !== null
      ? (frame as { sessionId?: unknown }).sessionId
      : undefined;
  return {
    type: 'error_response',
    sessionId: typeof id === 'string' ? id : 'unknown',
    status: 'error',
    error,
    ...(suggestion !== undefined && { suggestion }),
    exitCode,
  };
}

/**
 * Serialize a response for the client, or an error reply when the line would be
 * over the longest line the client reads.
 *
 * @param response - Response to send
 * @param request - Type of the request it answers
 * @param cap - Longest line, in characters (default {@link MAX_JSONL_BUFFER_SIZE})
 * @returns The JSONL line to write
 */
export function replyFrame(
  response: unknown,
  request: string,
  cap: number = MAX_JSONL_BUFFER_SIZE
): string {
  const frame = toJSONLFrame(response);
  const size = frame.length - 1;
  if (size <= cap) return frame;
  const err = replyTooLargeError(size, cap, request);
  return toJSONLFrame(
    errorFrame(response, err.message, err.suggestion, EXIT_CODES.INVALID_ARGUMENTS)
  );
}
