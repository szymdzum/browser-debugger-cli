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
  /**
   * @param maxSize - Longest unfinished line accepted (default {@link MAX_JSONL_BUFFER_SIZE})
   */
  constructor(private readonly maxSize: number = MAX_JSONL_BUFFER_SIZE) {}

  /** Chunks of the line still being received (joined once it is complete) */
  private parts: string[] = [];
  private partsLength = 0;

  /**
   * Process incoming chunk and extract complete JSONL frames.
   *
   * Only the new chunk is searched for line ends, and an unfinished line is
   * kept as a list of chunks, so a large response costs linear time (joining
   * and re-splitting the whole buffer on every chunk made multi-megabyte
   * responses, like a big HAR, quadratic).
   *
   * @param chunk - Incoming data chunk
   * @returns Array of complete JSONL frames (lines)
   * @throws JSONLBufferOverflowError if an unfinished line exceeds the maximum size
   */
  process(chunk: string): string[] {
    const lines: string[] = [];
    let start = 0;
    for (let end = chunk.indexOf('\n'); end !== -1; end = chunk.indexOf('\n', start)) {
      this.assertWithinLimit(this.partsLength + end - start);
      this.parts.push(chunk.slice(start, end));
      lines.push(this.parts.join(''));
      this.parts = [];
      this.partsLength = 0;
      start = end + 1;
    }
    if (start < chunk.length) {
      this.parts.push(chunk.slice(start));
      this.partsLength += chunk.length - start;
    }
    this.assertWithinLimit(this.partsLength);
    return lines.filter((line) => line.trim());
  }

  /**
   * Reject a message longer than the limit.
   *
   * @param length - Length of the message (so far)
   * @throws JSONLBufferOverflowError above the maximum size
   */
  private assertWithinLimit(length: number): void {
    if (length > this.maxSize) throw new JSONLBufferOverflowError(length, this.maxSize);
  }

  clear(): void {
    this.parts = [];
    this.partsLength = 0;
  }

  getBuffer(): string {
    return this.parts.join('');
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
