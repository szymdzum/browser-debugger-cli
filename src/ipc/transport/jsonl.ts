/**
 * JSONL Protocol Handler
 *
 * Utilities for parsing newline-delimited JSON streams.
 */

import { MAX_JSONL_BUFFER_SIZE } from '@/constants.js';

/**
 * Error thrown when JSONL buffer exceeds maximum size.
 */
export class JSONLBufferOverflowError extends Error {
  constructor(bufferSize: number, maxSize: number) {
    super(
      `JSONL buffer overflow: ${bufferSize} bytes exceeds maximum ${maxSize} bytes. ` +
        `Possible malicious or buggy process sending data without newlines.`
    );
    this.name = 'JSONLBufferOverflowError';
  }
}

/**
 * JSONL buffer for accumulating partial frames.
 *
 * Enforces a maximum buffer size to prevent OOM attacks from processes
 * that send unbounded data without newlines.
 */
export class JSONLBuffer {
  private buffer = '';

  /**
   * Process incoming chunk and extract complete JSONL frames.
   *
   * @param chunk - Incoming data chunk
   * @returns Array of complete JSONL frames (lines)
   * @throws JSONLBufferOverflowError if buffer exceeds MAX_JSONL_BUFFER_SIZE
   */
  process(chunk: string): string[] {
    this.buffer += chunk;

    // Check buffer size before processing to prevent OOM
    if (this.buffer.length > MAX_JSONL_BUFFER_SIZE) {
      throw new JSONLBufferOverflowError(this.buffer.length, MAX_JSONL_BUFFER_SIZE);
    }

    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.filter((line) => line.trim());
  }

  clear(): void {
    this.buffer = '';
  }

  getBuffer(): string {
    return this.buffer;
  }
}

/**
 * Parse JSONL frame into typed object.
 */
export function parseJSONLFrame<T>(line: string): T {
  return JSON.parse(line) as T;
}

/**
 * Serialize object to JSONL frame (JSON + newline).
 */
export function toJSONLFrame(obj: unknown): string {
  return JSON.stringify(obj) + '\n';
}
