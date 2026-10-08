/**
 * Session Query Messages
 *
 * Types for status and peek queries that don't modify session state.
 */

import type { IPCMessage } from './lifecycle.js';
import type { PageState, SessionActivity } from './types.js';

import type { DownloadInfo } from '@/ipc/protocol/domTypes.js';
import type { ColorScheme, NetworkRequest, TelemetryType, ViewportSize } from '@/types.js';

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
  /** Session process ID, i.e. the daemon (if session active). */
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
    /** When `--timeout` stops the session (epoch ms) */
    autoStopAt?: number;
    /** Viewport the page is emulated at (`--viewport`) */
    viewport?: ViewportSize;
    /** `prefers-color-scheme` the page is emulated with (`--color-scheme`) */
    colorScheme?: ColorScheme;
  };
  /** Session activity metrics. */
  activity?: SessionActivity;
  /** Current page state. */
  pageState?: PageState;
  /** Current navigation counter (increments on each page navigation). */
  navigationId?: number;
  /** Set while the session is shutting down */
  ending?: boolean;
  /** Set while `bdg <url>` is starting the session */
  starting?: { url: string; since: number };
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
  /** Number of recent items to return. 0 = all. */
  lastN?: number;
  /** Return items of one kind only. */
  only?: 'network' | 'console';
  /** Include request/response headers in network items. */
  withHeaders?: boolean;
}

/**
 * Peek response data.
 */
export interface PeekResponseData {
  /** Session process ID (the daemon). */
  sessionPid: number;
  /** Preview of collected data. */
  preview: {
    version: string;
    success: boolean;
    timestamp: string;
    duration: number;
    target: { url: string; title: string };
    data: { network?: unknown[]; console?: unknown[] };
    totals: { network: number; console: number };
    currentNavigationId?: number;
    /** Downloads that began during the session, oldest first */
    downloads?: DownloadInfo[];
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
 * HAR data request (client → daemon).
 */
export interface HARDataRequest extends IPCMessage {
  type: 'har_data_request';
}

/**
 * HAR data response data.
 */
export interface HARDataResponseData {
  /** Session process ID (the daemon). */
  sessionPid: number;
  /** Network requests for HAR export. */
  requests: NetworkRequest[];
}

/**
 * HAR data response (daemon → client).
 */
export interface HARDataResponse extends IPCMessage {
  type: 'har_data_response';
  status: 'ok' | 'error';
  data?: HARDataResponseData;
  error?: string;
}

/**
 * Union of all session query message types.
 */
export type QueryMessageType =
  StatusRequest | StatusResponse | PeekRequest | PeekResponse | HARDataRequest | HARDataResponse;
