import type { ChildProcess } from 'child_process';

export interface CDPMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code?: number; message: string };
  sessionId?: string;
}

export interface CDPTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface DOMData {
  url: string;
  title: string;
  outerHTML: string;
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number | undefined;
  mimeType?: string | undefined;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string | undefined;
  responseBody?: string | undefined;
  navigationId?: number | undefined; // Navigation counter when request was made
}

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
  args?: unknown[]; // Raw console arguments from CDP (mixed types)
  navigationId?: number | undefined; // Navigation counter when message was logged
}

/**
 * Screenshot capture data returned by dom screenshot command
 */
export interface ScreenshotData {
  /** Absolute path where screenshot was saved */
  path: string;
  /** Image format */
  format: 'png' | 'jpeg';
  /** JPEG quality (0-100), only present for JPEG format */
  quality?: number;
  /** Image width in pixels */
  width: number;
  /** Image height in pixels */
  height: number;
  /** File size in bytes */
  size: number;
  /** Viewport dimensions when fullPage is false */
  viewport?: {
    width: number;
    height: number;
  };
  /** Whether screenshot captured full page or just viewport */
  fullPage: boolean;
}

export interface BdgOutput {
  version: string; // Package version for schema tracking
  success: boolean;
  timestamp: string;
  duration: number;
  target: {
    url: string;
    title: string;
  };
  data: {
    dom?: DOMData;
    network?: NetworkRequest[];
    console?: ConsoleMessage[];
  };
  error?: string;
  partial?: boolean; // Flag to indicate this is partial/incomplete data (live preview)
}

export type TelemetryType = 'dom' | 'network' | 'console';

/**
 * Optional tuning parameters for CDPConnection.connect.
 */
export interface ConnectionOptions {
  /** Milliseconds to wait for the initial socket open */
  timeout?: number;
  /** Number of connection attempts before failing */
  maxRetries?: number;
  /** Reconnect automatically when the socket closes */
  autoReconnect?: boolean;
  /** Interval between ping frames to keep CDP alive */
  keepaliveInterval?: number;
  /** Async hook invoked after a successful reconnect */
  onReconnect?: (() => Promise<void>) | undefined;
  /** Async hook invoked when WebSocket closes unexpectedly (P1 Fix #1) */
  onDisconnect?: ((code: number, reason: string) => void | Promise<void>) | undefined;
}

export type CleanupFunction = () => void;

/**
 * Information about a launched Chrome instance.
 */
export interface LaunchedChrome {
  /** Process ID of the Chrome instance */
  pid: number;
  /** Remote debugging port Chrome is listening on */
  port: number;
  /** Resolved Chrome user data directory (profile path) */
  userDataDir?: string | undefined;
  /** Child process handle (for advanced use cases like log streaming) */
  process: ChildProcess | null;
  /** Async function to terminate Chrome and cleanup temp directories */
  kill: () => Promise<void>;
}
