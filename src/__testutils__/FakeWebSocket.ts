/**
 * FakeWebSocket - Complete WebSocket boundary fake for testing
 *
 * Mimics the `ws` library API to enable contract testing of CDPConnection
 * without network I/O.
 *
 * Key features:
 * - Full ws API compatibility (readyState, ping, pong, send, close, terminate)
 * - Event emitters (open, message, close, error, ping, pong)
 * - Test control methods (simulate*) for driving state from tests
 * - Defensive copies in verification methods (getSentMessages) prevent mutation
 */

import { EventEmitter } from 'node:events';

// ws library readyState constants
export const CONNECTING = 0;
export const OPEN = 1;
export const CLOSING = 2;
export const CLOSED = 3;

type ReadyState = typeof CONNECTING | typeof OPEN | typeof CLOSING | typeof CLOSED;

export class FakeWebSocket extends EventEmitter {
  // ws API - readyState property
  public readyState: ReadyState = CONNECTING;

  // Internal state
  private sentMessages: string[] = [];
  private pingSentCount = 0;
  private pongSentCount = 0;
  private closeCode: number | null = null;
  private closeReason: string | null = null;

  // ws API constants
  static readonly CONNECTING = CONNECTING;
  static readonly OPEN = OPEN;
  static readonly CLOSING = CLOSING;
  static readonly CLOSED = CLOSED;

  constructor() {
    super();
  }

  /**
   * ws API - Send a message
   * Throws if connection is not OPEN
   */
  send(data: string, callback?: (err?: Error) => void): void {
    if (this.readyState !== OPEN) {
      const err = new Error('WebSocket is not open: readyState ' + this.readyState);
      if (callback) {
        callback(err);
      } else {
        throw err;
      }
      return;
    }

    this.sentMessages.push(data);
    if (callback) {
      callback();
    }
  }

  /**
   * ws API - Send a ping frame
   */
  ping(_data?: unknown, _mask?: boolean, callback?: (err?: Error) => void): void {
    if (this.readyState !== OPEN) {
      const err = new Error('WebSocket is not open');
      if (callback) {
        callback(err);
      }
      return;
    }

    this.pingSentCount++;
    this.emit('ping', _data);
    if (callback) {
      callback();
    }
  }

  /**
   * ws API - Send a pong frame (usually in response to ping)
   */
  pong(_data?: unknown, _mask?: boolean, callback?: (err?: Error) => void): void {
    if (this.readyState !== OPEN) {
      const err = new Error('WebSocket is not open');
      if (callback) {
        callback(err);
      }
      return;
    }

    this.pongSentCount++;
    if (callback) {
      callback();
    }
  }

  /**
   * ws API - Close connection gracefully
   * Transitions: OPEN -> CLOSING -> CLOSED
   */
  close(code?: number, reason?: string): void {
    if (this.readyState === CLOSED || this.readyState === CLOSING) {
      return;
    }

    this.readyState = CLOSING;
    this.closeCode = code ?? null;
    this.closeReason = reason ?? null;

    // Immediately transition to CLOSED and emit close event
    // In real ws, there's a handshake, but for tests we can be immediate
    this.readyState = CLOSED;
    this.emit('close', code ?? 1000, reason ?? '');
  }

  /**
   * ws API - Forceful close without handshake
   * Immediately transitions to CLOSED
   */
  terminate(): void {
    if (this.readyState === CLOSED) {
      return;
    }

    this.readyState = CLOSED;
    this.closeCode = 1006;
    this.closeReason = 'Connection terminated';
    this.emit('close', 1006, 'Connection terminated');
  }

  /**
   * TEST CONTROL - Simulate connection open
   * Transitions: CONNECTING -> OPEN, emits 'open'
   */
  simulateOpen(): void {
    if (this.readyState !== CONNECTING) {
      throw new Error('Can only open from CONNECTING state');
    }

    this.readyState = OPEN;
    this.emit('open');
  }

  /**
   * TEST CONTROL - Simulate receiving a message
   * Only valid in OPEN state
   */
  simulateMessage(data: string | Buffer): void {
    if (this.readyState !== OPEN) {
      throw new Error('Cannot receive message when not OPEN');
    }

    this.emit('message', data);
  }

  /**
   * TEST CONTROL - Simulate connection close
   * Transitions to CLOSED and emits 'close'
   */
  simulateClose(code: number, reason: string): void {
    if (this.readyState === CLOSED) {
      return;
    }

    this.readyState = CLOSED;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit('close', code, reason);
  }

  /**
   * TEST CONTROL - Simulate connection error
   * Emits 'error' event
   */
  simulateError(error: Error): void {
    this.emit('error', error);
  }

  /**
   * TEST CONTROL - Simulate receiving a pong frame
   * Emits 'pong' event (for keepalive tests)
   */
  simulatePong(data?: Buffer): void {
    if (this.readyState !== OPEN) {
      throw new Error('Cannot receive pong when not OPEN');
    }

    this.emit('pong', data);
  }

  /**
   * VERIFICATION - Get sent messages (defensive copy)
   * Returns shallow copy to prevent accidental mutation between assertions
   */
  getSentMessages(): string[] {
    return [...this.sentMessages];
  }

  /**
   * VERIFICATION - Get number of pings sent
   */
  getPingSent(): number {
    return this.pingSentCount;
  }

  /**
   * VERIFICATION - Get number of pongs sent
   */
  getPongSent(): number {
    return this.pongSentCount;
  }

  /**
   * VERIFICATION - Get close code (if closed)
   */
  getCloseCode(): number | null {
    return this.closeCode;
  }

  /**
   * VERIFICATION - Get close reason (if closed)
   */
  getCloseReason(): string | null {
    return this.closeReason;
  }

  /**
   * TEST CONTROL - Reset to initial state
   */
  reset(): void {
    this.readyState = CONNECTING;
    this.sentMessages = [];
    this.pingSentCount = 0;
    this.pongSentCount = 0;
    this.closeCode = null;
    this.closeReason = null;
    this.removeAllListeners();
  }
}
