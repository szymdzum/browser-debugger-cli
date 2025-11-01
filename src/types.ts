export interface CDPMessage {
  id: number;
  method?: string;
  params?: Record<string, unknown>; // CDP params vary by method
  result?: unknown; // CDP results vary by method
  error?: { message: string };
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
 * Optional tuning parameters for {@link CDPConnection.connect}.
 * @property timeout           Milliseconds to wait for the initial socket open.
 * @property maxRetries        Number of connection attempts before failing.
 * @property autoReconnect     Reconnect automatically when the socket closes.
 * @property keepaliveInterval Interval between ping frames to keep CDP alive.
 * @property onReconnect       Async hook invoked after a successful reconnect.
 */
export interface ConnectionOptions {
  timeout?: number;
  maxRetries?: number;
  autoReconnect?: boolean;
  keepaliveInterval?: number;
  onReconnect?: (() => Promise<void>) | undefined;
}

export type CleanupFunction = () => void;

/**
 * Lightweight snapshot of an active BDG session used by higher-level tooling.
 * @property isActive   Indicates whether collectors are currently running.
 * @property startTime  Epoch timestamp (ms) when the session began.
 * @property collectors Enabled collectors for this run (dom/network/console).
 */
export interface SessionState {
  isActive: boolean;
  startTime: number;
  collectors: CollectorType[];
}

/**
 * Information about a launched Chrome instance.
 */
export interface LaunchedChrome {
  pid: number;
  port: number;
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
