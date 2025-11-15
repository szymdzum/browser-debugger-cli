/**
 * IPC Types (flat)
 */

import type { TelemetryType } from '@/types.js';

export interface IPCMessage {
  type: string;
  sessionId: string;
}

export enum IPCErrorCode {
  NO_SESSION = 'NO_SESSION',
  SESSION_KILL_FAILED = 'SESSION_KILL_FAILED',
  SESSION_ALREADY_RUNNING = 'SESSION_ALREADY_RUNNING',
  WORKER_START_FAILED = 'WORKER_START_FAILED',
  CHROME_LAUNCH_FAILED = 'CHROME_LAUNCH_FAILED',
  CDP_TIMEOUT = 'CDP_TIMEOUT',
  DAEMON_ERROR = 'DAEMON_ERROR',
}

export interface HandshakeRequest extends IPCMessage {
  type: 'handshake_request';
}

export interface HandshakeResponse extends IPCMessage {
  type: 'handshake_response';
  status: 'ok' | 'error';
  message?: string;
}

export interface StatusRequest extends IPCMessage {
  type: 'status_request';
}

export interface SessionActivity {
  networkRequestsCaptured: number;
  consoleMessagesCaptured: number;
  lastNetworkRequestAt?: number;
  lastConsoleMessageAt?: number;
}

export interface PageState {
  url: string;
  title: string;
}

export interface StatusResponseData {
  daemonPid: number;
  daemonStartTime: number;
  socketPath: string;
  sessionPid?: number;
  sessionMetadata?: {
    bdgPid: number;
    chromePid?: number;
    startTime: number;
    port: number;
    targetId?: string;
    webSocketDebuggerUrl?: string;
    activeTelemetry?: TelemetryType[];
  };
  activity?: SessionActivity;
  pageState?: PageState;
}

export interface StatusResponse extends IPCMessage {
  type: 'status_response';
  status: 'ok' | 'error';
  data?: StatusResponseData;
  error?: string;
}

export interface PeekRequest extends IPCMessage {
  type: 'peek_request';
}

export interface PeekResponseData {
  sessionPid: number;
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

export interface PeekResponse extends IPCMessage {
  type: 'peek_response';
  status: 'ok' | 'error';
  data?: PeekResponseData;
  error?: string;
}

export interface StartSessionRequest extends IPCMessage {
  type: 'start_session_request';
  url: string;
  port?: number;
  timeout?: number;
  telemetry?: TelemetryType[];
  includeAll?: boolean;
  userDataDir?: string;
  maxBodySize?: number;
  headless?: boolean;
  chromeWsUrl?: string;
}

export interface StartSessionResponseData {
  workerPid: number;
  chromePid: number;
  port: number;
  targetUrl: string;
  targetTitle?: string;
}

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

export interface StopSessionRequest extends IPCMessage {
  type: 'stop_session_request';
}

export interface StopSessionResponse extends IPCMessage {
  type: 'stop_session_response';
  status: 'ok' | 'error';
  message?: string;
  errorCode?: IPCErrorCode;
  chromePid?: number;
}

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
