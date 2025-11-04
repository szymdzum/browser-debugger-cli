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

export type CollectorType = 'dom' | 'network' | 'console';

// CDP Event Parameter Types
export interface CDPNetworkRequestParams {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    postData?: string;
  };
  timestamp: number;
}

export interface CDPNetworkResponseParams {
  requestId: string;
  response: {
    url: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
    mimeType: string;
  };
}

export interface CDPNetworkLoadingFinishedParams {
  requestId: string;
  timestamp: number;
  encodedDataLength: number; // Total encoded data length in bytes
}

export interface CDPNetworkLoadingFailedParams {
  requestId: string;
  errorText: string;
  canceled?: boolean;
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

export interface CDPTargetDestroyedParams {
  targetId: string;
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
}

/**
 * Session-level options for BDG data collection.
 */
export interface SessionOptions {
  /** Disable all default filtering (tracking domains, dev server noise, etc) */
  includeAll?: boolean;
  /** Override auto-optimization and fetch all response bodies */
  fetchAllBodies?: boolean;
  /** URL patterns for bodies to fetch (trumps exclude) */
  fetchBodiesInclude?: string[];
  /** URL patterns for bodies to skip */
  fetchBodiesExclude?: string[];
  /** URL patterns for requests to capture (trumps exclude) */
  networkInclude?: string[];
  /** URL patterns for requests to exclude */
  networkExclude?: string[];
  /** Maximum response body size in bytes (default: 5MB) */
  maxBodySize?: number;
  /** Use compact JSON format (no indentation) for output files */
  compact?: boolean;
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
 * CDP Target.createTarget response.
 */
export interface CDPCreateTargetResponse {
  targetId: string;
}

/**
 * CDP Target.attachToTarget response.
 */
export interface CDPAttachToTargetResponse {
  sessionId: string;
}

/**
 * CDP Target.getTargets response.
 */
export interface CDPGetTargetsResponse {
  targetInfos: Array<{
    targetId: string;
    type: string;
    title: string;
    url: string;
    attached: boolean;
  }>;
}

/**
 * CDP Page.navigate response.
 */
export interface CDPNavigateResponse {
  frameId: string;
  loaderId?: string;
  errorText?: string;
}

/**
 * CDP Page.lifecycleEvent parameters.
 */
export interface CDPLifecycleEventParams {
  frameId: string;
  loaderId: string;
  name: string; // 'DOMContentLoaded', 'load', 'networkAlmostIdle', 'networkIdle', etc.
  timestamp: number;
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

/**
 * Result of a tab creation attempt with error context
 */
export interface TabCreationResult {
  success: boolean;
  target?: CDPTarget;
  error?: TabCreationError;
  strategy: 'CDP' | 'HTTP';
  timing: {
    attemptStartMs: number;
    durationMs?: number;
  };
}

/**
 * Structured error information for tab creation failures
 */
export interface TabCreationError {
  type:
    | 'CDP_COMMAND_FAILED'
    | 'VERIFICATION_FAILED'
    | 'VERIFICATION_TIMEOUT'
    | 'HTTP_REQUEST_FAILED'
    | 'TARGET_NOT_FOUND';
  message: string;
  originalError?: unknown;
  context: {
    targetId?: string;
    httpStatus?: number;
    chromeVersion?: string;
    stage?: 'cdp_command' | 'verification' | 'http_request';
  };
}
