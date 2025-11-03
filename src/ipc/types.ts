/**
 * IPC Protocol Types - Minimal JSONL handshake MVP
 *
 * This module defines the bare minimum message types needed to establish
 * a handshake between the CLI client and the daemon over JSONL protocol.
 */

import type { CollectorType } from '@/types.js';

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
    activeCollectors?: CollectorType[];
  };
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
 * Reuses BdgOutput structure from partial/preview file.
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
 * Union type of all IPC messages (for future extension).
 */
export type IPCMessageType =
  | HandshakeRequest
  | HandshakeResponse
  | StatusRequest
  | StatusResponse
  | PeekRequest
  | PeekResponse;
