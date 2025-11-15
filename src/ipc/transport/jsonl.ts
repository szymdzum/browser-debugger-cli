/**
 * JSONL Protocol Handler
 *
 * Utilities for parsing newline-delimited JSON streams.
 */

/**
 * JSONL buffer for accumulating partial frames.
 */
export class JSONLBuffer {
  private buffer = '';

  process(chunk: string): string[] {
    this.buffer += chunk;
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
