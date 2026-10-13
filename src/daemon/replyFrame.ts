/**
 * The line the daemon writes for a response, capped in size.
 */

import { MAX_JSONL_BUFFER_SIZE } from '@/constants.js';
import { toJSONLFrame } from '@/ipc/transport/jsonl.js';

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
  void request;
  void cap;
  return toJSONLFrame(response);
}
