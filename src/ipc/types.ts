/**
 * IPC Protocol Types - Minimal JSONL handshake MVP
 *
 * This module defines the bare minimum message types needed to establish
 * a handshake between the CLI client and the daemon over JSONL protocol.
 */

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
 * Union type of all IPC messages (for future extension).
 */
export type IPCMessageType = HandshakeRequest | HandshakeResponse;
