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
  collectors?: CollectorType[]; // Collectors to activate
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
 * DOM query request sent from CLI client to daemon.
 * Queries elements by CSS selector.
 */
export interface DomQueryRequest extends IPCMessage {
  type: 'dom_query_request';
  sessionId: string; // Unique request identifier
  selector: string; // CSS selector to query
}

/**
 * DOM query response payload containing matched elements.
 */
export interface DomQueryResponseData {
  selector: string;
  count: number;
  nodes: Array<{
    index: number;
    nodeId: number;
    tag?: string;
    classes?: string[];
    preview?: string;
  }>;
}

/**
 * DOM query response sent from daemon to CLI client.
 */
export interface DomQueryResponse extends IPCMessage {
  type: 'dom_query_response';
  sessionId: string; // Echo back the session ID from request
  status: 'ok' | 'error';
  data?: DomQueryResponseData;
  error?: string; // Present if status === 'error'
}

/**
 * DOM highlight request sent from CLI client to daemon.
 * Highlights elements in the browser.
 */
export interface DomHighlightRequest extends IPCMessage {
  type: 'dom_highlight_request';
  sessionId: string; // Unique request identifier
  selector?: string; // CSS selector to query (mutually exclusive with index/nodeId)
  index?: number; // Index from last query cache (mutually exclusive with selector/nodeId)
  nodeId?: number; // Direct nodeId (mutually exclusive with selector/index)
  first?: boolean; // Target first match only (with selector)
  nth?: number; // Target nth match (with selector)
  color?: string; // Highlight color preset
  opacity?: number; // Highlight opacity (0.0 - 1.0)
}

/**
 * DOM highlight response payload.
 */
export interface DomHighlightResponseData {
  highlighted: number; // Number of elements highlighted
  nodeIds: number[]; // NodeIds of highlighted elements
}

/**
 * DOM highlight response sent from daemon to CLI client.
 */
export interface DomHighlightResponse extends IPCMessage {
  type: 'dom_highlight_response';
  sessionId: string; // Echo back the session ID from request
  status: 'ok' | 'error';
  data?: DomHighlightResponseData;
  error?: string; // Present if status === 'error'
}

/**
 * DOM get request sent from CLI client to daemon.
 * Gets full HTML and attributes for elements.
 */
export interface DomGetRequest extends IPCMessage {
  type: 'dom_get_request';
  sessionId: string; // Unique request identifier
  selector?: string; // CSS selector to query (mutually exclusive with index/nodeId)
  index?: number; // Index from last query cache (mutually exclusive with selector/nodeId)
  nodeId?: number; // Direct nodeId (mutually exclusive with selector/index)
  all?: boolean; // Target all matches (with selector)
  nth?: number; // Target nth match (with selector)
}

/**
 * DOM node information returned by DOM get command.
 */
export interface DomNodeInfo {
  nodeId: number;
  tag?: string;
  attributes?: Record<string, string>;
  classes?: string[];
  outerHTML?: string;
}

/**
 * DOM get response payload.
 */
export interface DomGetResponseData {
  nodes: DomNodeInfo[]; // Array of node information (single element if not --all)
}

/**
 * DOM get response sent from daemon to CLI client.
 */
export interface DomGetResponse extends IPCMessage {
  type: 'dom_get_response';
  sessionId: string; // Echo back the session ID from request
  status: 'ok' | 'error';
  data?: DomGetResponseData;
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
  | PeekResponse
  | StartSessionRequest
  | StartSessionResponse
  | StopSessionRequest
  | StopSessionResponse
  | DomQueryRequest
  | DomQueryResponse
  | DomHighlightRequest
  | DomHighlightResponse
  | DomGetRequest
  | DomGetResponse;

/**
 * Union type of all IPC request messages.
 */
export type IPCRequest =
  | HandshakeRequest
  | StatusRequest
  | PeekRequest
  | StartSessionRequest
  | StopSessionRequest
  | DomQueryRequest
  | DomHighlightRequest
  | DomGetRequest;

/**
 * Union type of all IPC response messages.
 */
export type IPCResponse =
  | HandshakeResponse
  | StatusResponse
  | PeekResponse
  | StartSessionResponse
  | StopSessionResponse
  | DomQueryResponse
  | DomHighlightResponse
  | DomGetResponse;
