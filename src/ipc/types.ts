/**
 * IPC Protocol Types - Minimal JSONL handshake MVP
 *
 * This module defines the bare minimum message types needed to establish
 * a handshake between the CLI client and the daemon over JSONL protocol.
 */

import type { TelemetryType } from '@/types.js';

/**
 * Base envelope for all IPC messages.
 * JSONL format: Each message is a single line of JSON.
 */
export interface IPCMessage {
  type: string;
  sessionId: string;
}

/**
 * Handshake request sent from CLI client to daemon.
 * First message in the IPC protocol - establishes connection.
 */
export interface HandshakeRequest extends IPCMessage {
  type: 'handshake_request';
  sessionId: string; // Unique session identifier (UUID or similar)
}

/**
 * Handshake response sent from daemon to CLI client.
 * Confirms successful connection establishment.
 */
export interface HandshakeResponse extends IPCMessage {
  type: 'handshake_response';
  sessionId: string; // Echo back the session ID from request
  status: 'ok' | 'error';
  message?: string; // Optional status message
}

/**
 * Status request sent from CLI client to daemon.
 * Requests current daemon and session state information.
 */
export interface StatusRequest extends IPCMessage {
  type: 'status_request';
  sessionId: string; // Unique request identifier
}

/**
 * Session activity tracking data.
 *
 * Captures real-time activity metrics from the worker process including
 * network requests, console messages, and DOM query activity.
 */
export interface SessionActivity {
  /** Total network requests captured since session start */
  networkRequestsCaptured: number;
  /** Total console messages captured since session start */
  consoleMessagesCaptured: number;
  /** Timestamp of last network request (milliseconds since epoch) */
  lastNetworkRequestAt?: number;
  /** Timestamp of last console message (milliseconds since epoch) */
  lastConsoleMessageAt?: number;
}

/**
 * Page state information from the browser.
 *
 * Provides current page metadata and readiness indicators.
 */
export interface PageState {
  /** Current page URL */
  url: string;
  /** Current page title */
  title: string;
}

/**
 * Status response payload containing daemon and session metadata.
 */
export interface StatusResponseData {
  daemonPid: number;
  daemonStartTime: number;
  socketPath: string;
  sessionPid?: number; // Present if a session is active
  sessionMetadata?: {
    bdgPid: number;
    chromePid?: number;
    startTime: number;
    port: number;
    targetId?: string;
    webSocketDebuggerUrl?: string;
    activeTelemetry?: TelemetryType[];
  };
  /** Live activity metrics from worker (only present if session is active) */
  activity?: SessionActivity;
  /** Current page state from browser (only present if session is active) */
  pageState?: PageState;
}

/**
 * Status response sent from daemon to CLI client.
 */
export interface StatusResponse extends IPCMessage {
  type: 'status_response';
  sessionId: string; // Echo back the session ID from request
  status: 'ok' | 'error';
  data?: StatusResponseData;
  error?: string; // Present if status === 'error'
}

/**
 * Peek request sent from CLI client to daemon.
 * Requests current session preview data (lightweight snapshot).
 */
export interface PeekRequest extends IPCMessage {
  type: 'peek_request';
  sessionId: string; // Unique request identifier
}

/**
 * Peek response payload containing session preview data.
 * Live data fetched from worker via IPC (no file reads).
 */
export interface PeekResponseData {
  sessionPid: number;
  preview: {
    version: string;
    success: boolean;
    timestamp: string;
    duration: number;
    target: {
      url: string;
      title: string;
    };
    data: {
      dom?: unknown;
      network?: unknown[];
      console?: unknown[];
    };
    partial?: boolean;
  };
}

/**
 * Peek response sent from daemon to CLI client.
 */
export interface PeekResponse extends IPCMessage {
  type: 'peek_response';
  sessionId: string; // Echo back the session ID from request
  status: 'ok' | 'error';
  data?: PeekResponseData;
  error?: string; // Present if status === 'error'
}

/**
 * Error codes for IPC responses.
 * Provides structured error handling across daemon and CLI.
 */
export enum IPCErrorCode {
  NO_SESSION = 'NO_SESSION',
  SESSION_KILL_FAILED = 'SESSION_KILL_FAILED',
  SESSION_ALREADY_RUNNING = 'SESSION_ALREADY_RUNNING',
  WORKER_START_FAILED = 'WORKER_START_FAILED',
  CHROME_LAUNCH_FAILED = 'CHROME_LAUNCH_FAILED',
  CDP_TIMEOUT = 'CDP_TIMEOUT',
  DAEMON_ERROR = 'DAEMON_ERROR',
}

/**
 * Start session request sent from CLI client to daemon.
 * Requests launching a new browser session for the given URL.
 */
export interface StartSessionRequest extends IPCMessage {
  type: 'start_session_request';
  sessionId: string; // Unique request identifier
  url: string; // Target URL to navigate to
  port?: number; // Chrome debugging port (default: 9222)
  timeout?: number; // Auto-stop timeout in seconds
  telemetry?: TelemetryType[]; // Telemetry modules to activate
  includeAll?: boolean; // Include all data (disable filtering)
  userDataDir?: string; // Custom Chrome profile directory
  maxBodySize?: number; // Max response body size in KB
}

/**
 * Start session response payload containing worker metadata.
 */
export interface StartSessionResponseData {
  workerPid: number; // Worker process PID
  chromePid: number; // Chrome process PID
  port: number; // Chrome debugging port
  targetUrl: string; // Target URL
  targetTitle?: string; // Target page title
}

/**
 * Start session response sent from daemon to CLI client.
 */
export interface StartSessionResponse extends IPCMessage {
  type: 'start_session_response';
  sessionId: string; // Echo back the session ID from request
  status: 'ok' | 'error';
  data?: StartSessionResponseData;
  message?: string; // Status or error message
  errorCode?: IPCErrorCode; // Structured error code (present when status === 'error')
  existingSession?: {
    // Present when errorCode === SESSION_ALREADY_RUNNING
    pid: number;
    targetUrl?: string;
    startTime?: number;
    duration?: number;
  };
}

/**
 * Stop session request sent from CLI client to daemon.
 * Requests termination of the currently running session.
 */
export interface StopSessionRequest extends IPCMessage {
  type: 'stop_session_request';
  sessionId: string; // Unique request identifier
}

/**
 * Stop session response sent from daemon to CLI client.
 */
export interface StopSessionResponse extends IPCMessage {
  type: 'stop_session_response';
  sessionId: string; // Echo back the session ID from request
  status: 'ok' | 'error';
  message?: string; // Status or error message
  errorCode?: IPCErrorCode; // Structured error code (present when status === 'error')
  chromePid?: number; // Chrome PID captured before cleanup (present when session was stopped)
}

/**
 * NOTE: DOM command types (DomQueryCommand, DomHighlightCommand, DomGetCommand, etc.)
 * are now defined in \@/ipc/commands.ts
 */

/**
 * Union type of all IPC messages (for future extension).
 */
export type IPCMessageType =
  | HandshakeRequest
  | HandshakeResponse
  | StatusRequest
  | StatusResponse
  | PeekRequest
  | PeekResponse
  | StartSessionRequest
  | StartSessionResponse
  | StopSessionRequest
  | StopSessionResponse;
