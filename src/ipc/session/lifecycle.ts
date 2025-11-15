/**
 * Session Lifecycle Messages
 *
 * Types for handshake, start session, and stop session operations.
 */

import type { IPCErrorCode } from './errors.js';

import type { TelemetryType } from '@/types.js';

/**
 * Base message interface with type and session ID.
 */
export interface IPCMessage {
  type: string;
  sessionId: string;
}

/**
 * Handshake request (client → daemon).
 */
export interface HandshakeRequest extends IPCMessage {
  type: 'handshake_request';
}

/**
 * Handshake response (daemon → client).
 */
export interface HandshakeResponse extends IPCMessage {
  type: 'handshake_response';
  status: 'ok' | 'error';
  message?: string;
}

/**
 * Start session request (client → daemon).
 */
export interface StartSessionRequest extends IPCMessage {
  type: 'start_session_request';
  /** Target URL to navigate to. */
  url: string;
  /** CDP port to use. */
  port?: number;
  /** Auto-stop timeout in seconds. */
  timeout?: number;
  /** Telemetry collectors to enable. */
  telemetry?: TelemetryType[];
  /** Include all data (disable filtering). */
  includeAll?: boolean;
  /** Custom Chrome user data directory. */
  userDataDir?: string;
  /** Max response body size in MB. */
  maxBodySize?: number;
  /** Launch Chrome in headless mode. */
  headless?: boolean;
  /** Connect to existing Chrome instance. */
  chromeWsUrl?: string;
}

/**
 * Start session response data.
 */
export interface StartSessionResponseData {
  /** Worker process ID. */
  workerPid: number;
  /** Chrome process ID. */
  chromePid: number;
  /** CDP port. */
  port: number;
  /** Target page URL. */
  targetUrl: string;
  /** Target page title. */
  targetTitle?: string;
}

/**
 * Start session response (daemon → client).
 */
export interface StartSessionResponse extends IPCMessage {
  type: 'start_session_response';
  status: 'ok' | 'error';
  data?: StartSessionResponseData;
  message?: string;
  errorCode?: IPCErrorCode;
  existingSession?: {
    pid: number;
    targetUrl?: string;
    startTime?: number;
    duration?: number;
  };
}

/**
 * Stop session request (client → daemon).
 */
export interface StopSessionRequest extends IPCMessage {
  type: 'stop_session_request';
}

/**
 * Stop session response (daemon → client).
 */
export interface StopSessionResponse extends IPCMessage {
  type: 'stop_session_response';
  status: 'ok' | 'error';
  message?: string;
  errorCode?: IPCErrorCode;
  chromePid?: number;
}

/**
 * Union of all session lifecycle message types.
 */
export type LifecycleMessageType =
  | HandshakeRequest
  | HandshakeResponse
  | StartSessionRequest
  | StartSessionResponse
  | StopSessionRequest
  | StopSessionResponse;
