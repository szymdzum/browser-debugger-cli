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
}

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
  args?: unknown[]; // Raw console arguments from CDP (mixed types)
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

// CDP Supporting Types
export type CDPResourceType =
  | 'Document'
  | 'Stylesheet'
  | 'Image'
  | 'Media'
  | 'Font'
  | 'Script'
  | 'TextTrack'
  | 'XHR'
  | 'Fetch'
  | 'Prefetch'
  | 'EventSource'
  | 'WebSocket'
  | 'Manifest'
  | 'SignedExchange'
  | 'Ping'
  | 'CSPViolationReport'
  | 'Preflight'
  | 'FedCM'
  | 'Other';

export type CDPMonotonicTime = number;
export type CDPTimeSinceEpoch = number;
export type CDPLoaderId = string;
export type CDPFrameId = string;

export interface CDPInitiator {
  type: 'parser' | 'script' | 'preload' | 'SignedExchange' | 'preflight' | 'FedCM' | 'other';
  stack?: unknown; // Runtime.StackTrace - keeping as unknown for simplicity
  url?: string;
  lineNumber?: number;
  columnNumber?: number;
  requestId?: string;
}

// CDP Event Parameter Types
export interface CDPNetworkRequestParams {
  requestId: string;
  loaderId?: CDPLoaderId;
  documentURL?: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
  };
  timestamp: CDPMonotonicTime;
  wallTime?: CDPTimeSinceEpoch;
  initiator?: CDPInitiator;
  redirectHasExtraInfo?: boolean;
  redirectResponse?: unknown; // Response type - keeping as unknown for simplicity
  type?: CDPResourceType;
  frameId?: CDPFrameId;
  hasUserGesture?: boolean;
}

export interface CDPNetworkResponseParams {
  requestId: string;
  loaderId?: CDPLoaderId;
  timestamp?: CDPMonotonicTime;
  type?: CDPResourceType;
  response: {
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    mimeType: string;
  };
  hasExtraInfo?: boolean;
  frameId?: CDPFrameId;
}

export interface CDPNetworkLoadingFinishedParams {
  requestId: string;
  timestamp: number;
  encodedDataLength: number; // Total encoded data length in bytes
}

export interface CDPNetworkLoadingFailedParams {
  requestId: string;
  timestamp?: CDPMonotonicTime;
  type?: CDPResourceType;
  errorText: string;
  canceled?: boolean;
  blockedReason?: string;
  corsErrorStatus?: unknown; // CorsErrorStatus type - keeping as unknown for simplicity
}

export interface CDPConsoleAPICalledParams {
  type: string;
  args: Array<{
    type: string;
    value?: unknown; // Console argument value (varies by type: string, number, object, etc.)
    description?: string;
  }>;
  timestamp: number;
}

export interface CDPExceptionThrownParams {
  exceptionDetails: {
    text?: string;
    exception?: {
      description?: string;
    };
    timestamp?: number;
  };
}

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

/**
 * CDP DOM.getDocument response.
 */
export interface CDPGetDocumentResponse {
  root: {
    nodeId: number;
    backendNodeId: number;
    nodeType: number;
    nodeName: string;
    localName: string;
    nodeValue: string;
  };
}

/**
 * CDP DOM.getOuterHTML response.
 */
export interface CDPGetOuterHTMLResponse {
  outerHTML: string;
}

/**
 * CDP Page.getFrameTree response.
 */
export interface CDPGetFrameTreeResponse {
  frameTree: {
    frame: {
      id: string;
      loaderId?: string;
      url: string;
      domainAndRegistry?: string;
      securityOrigin?: string;
      mimeType: string;
      secureContextType?: string;
      crossOriginIsolatedContextType?: string;
      gatedAPIFeatures?: string[];
    };
    childFrames?: unknown[];
  };
}

/**
 * CDP Runtime.evaluate response.
 */
export interface CDPRuntimeEvaluateResponse {
  result: {
    type: string;
    value?: string | number | boolean;
    unserializableValue?: string;
    description?: string;
  };
  exceptionDetails?: {
    exceptionId: number;
    text: string;
    lineNumber: number;
    columnNumber: number;
  };
}

/**
 * CDP Network.getResponseBody response.
 */
export interface CDPGetResponseBodyResponse {
  body: string;
  base64Encoded: boolean;
}
