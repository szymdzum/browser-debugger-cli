/**
 * JSONL (JSON Lines) Parser
 *
 * Parses newline-delimited JSON messages from streaming data.
 * Maintains internal buffer to handle partial messages across chunks.
 */

import { getErrorMessage } from '@/connection/errors.js';
import type { Logger } from '@/ui/logging/index.js';

/**
 * Parses JSONL (newline-delimited JSON) from streaming data.
 */
export class JsonlParser {
  private buffer = '';

  constructor(private readonly log: Logger) {}

  /**
   * Parse a chunk of data into complete JSON messages.
   *
   * @param chunk - Buffer containing JSONL data
   * @returns Array of parsed JSON objects (empty if no complete messages)
   */
  parse(chunk: Buffer): unknown[] {
    this.buffer += chunk.toString('utf-8');

    // Split on newlines to find complete messages
    const lines = this.buffer.split('\n');
    // Keep incomplete line in buffer for next chunk
    this.buffer = lines.pop() ?? '';

    const messages: unknown[] = [];

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(line);
        messages.push(parsed);
      } catch (error) {
        this.log.debug(`Failed to parse JSONL line: ${getErrorMessage(error)}`);
      }
    }

    return messages;
  }

  /**
   * Clear internal buffer (useful for cleanup).
   */
  clear(): void {
    this.buffer = '';
  }

  /**
   * Get current buffer content (useful for debugging).
   */
  getBuffer(): string {
    return this.buffer;
  }
}
