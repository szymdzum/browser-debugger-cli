/**
 * Pending Request Manager
 *
 * Manages pending IPC requests with timeout handling.
 * Tracks requests waiting for worker responses and handles cleanup.
 */

import type { Socket } from 'net';

import type { CommandName, StatusResponseData } from '@/ipc/index.js';

/**
 * Pending request waiting for worker response.
 */
export interface PendingRequest {
  socket: Socket;
  sessionId: string;
  timeout: NodeJS.Timeout;
  /** Base status data (only for status requests) */
  statusData?: StatusResponseData;
  commandName?: CommandName;
}

/**
 * Manages pending requests with automatic timeout cleanup.
 */
export class PendingRequestManager {
  private readonly pending = new Map<string, PendingRequest>();

  /**
   * Add a pending request with timeout.
   */
  add(requestId: string, request: PendingRequest): void {
    this.pending.set(requestId, request);
  }

  /**
   * Get a pending request by ID.
   */
  get(requestId: string): PendingRequest | undefined {
    return this.pending.get(requestId);
  }

  /**
   * Remove a pending request and clear its timeout.
   */
  remove(requestId: string): PendingRequest | undefined {
    const request = this.pending.get(requestId);
    if (request) {
      clearTimeout(request.timeout);
      this.pending.delete(requestId);
    }
    return request;
  }

  /**
   * Get all pending requests.
   */
  getAll(): IterableIterator<[string, PendingRequest]> {
    return this.pending.entries();
  }

  /**
   * Get number of pending requests.
   */
  get size(): number {
    return this.pending.size;
  }

  /**
   * Clear all pending requests and their timeouts.
   */
  clear(): void {
    for (const [, request] of this.pending) {
      clearTimeout(request.timeout);
    }
    this.pending.clear();
  }
}
