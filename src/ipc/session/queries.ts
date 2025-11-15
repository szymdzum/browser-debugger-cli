/**
 * Session Query Messages
 *
 * Types for status and peek queries that don't modify session state.
 */

import type { IPCMessage } from './lifecycle.js';

import type { TelemetryType } from '@/types.js';

/**
 * Session activity metrics.
 */
export interface SessionActivity {
  /** Total network requests captured. */
  networkRequestsCaptured: number;
  /** Total console messages captured. */
  consoleMessagesCaptured: number;
  /** Timestamp of last network request. */
  lastNetworkRequestAt?: number;
  /** Timestamp of last console message. */
  lastConsoleMessageAt?: number;
}

/**
 * Current page state.
 */
export interface PageState {
  /** Current page URL. */
  url: string;
  /** Current page title. */
  title: string;
}

/**
 * Status request (client → daemon).
 */
export interface StatusRequest extends IPCMessage {
  type: 'status_request';
}

/**
 * Status response data.
 */
export interface StatusResponseData {
  /** Daemon process ID. */
  daemonPid: number;
  /** Daemon start timestamp. */
  daemonStartTime: number;
  /** Unix socket path. */
  socketPath: string;
  /** Worker process ID (if session active). */
  sessionPid?: number;
  /** Session metadata (if session active). */
  sessionMetadata?: {
    bdgPid: number;
    chromePid?: number;
    startTime: number;
    port: number;
    targetId?: string;
    webSocketDebuggerUrl?: string;
    activeTelemetry?: TelemetryType[];
  };
  /** Session activity metrics. */
  activity?: SessionActivity;
  /** Current page state. */
  pageState?: PageState;
}

/**
 * Status response (daemon → client).
 */
export interface StatusResponse extends IPCMessage {
  type: 'status_response';
  status: 'ok' | 'error';
  data?: StatusResponseData;
  error?: string;
}

/**
 * Peek request (client → daemon).
 */
export interface PeekRequest extends IPCMessage {
  type: 'peek_request';
}

/**
 * Peek response data.
 */
export interface PeekResponseData {
  /** Worker process ID. */
  sessionPid: number;
  /** Preview of collected data. */
  preview: {
    version: string;
    success: boolean;
    timestamp: string;
    duration: number;
    target: { url: string; title: string };
    data: { dom?: unknown; network?: unknown[]; console?: unknown[] };
    partial?: boolean;
  };
}

/**
 * Peek response (daemon → client).
 */
export interface PeekResponse extends IPCMessage {
  type: 'peek_response';
  status: 'ok' | 'error';
  data?: PeekResponseData;
  error?: string;
}

/**
 * Union of all session query message types.
 */
export type QueryMessageType = StatusRequest | StatusResponse | PeekRequest | PeekResponse;
