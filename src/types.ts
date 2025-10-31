export interface CDPMessage {
  id: number;
  method?: string;
  params?: Record<string, any>;  // CDP params vary by method
  result?: any;  // CDP results vary by method
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
  status?: number;
  mimeType?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
}

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
  args?: any[];  // Raw console arguments from CDP (mixed types)
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
    value?: any;  // Console argument value (varies by type: string, number, object, etc.)
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

export interface ConnectionOptions {
  timeout?: number;
  maxRetries?: number;
  autoReconnect?: boolean;
  keepaliveInterval?: number;
  onReconnect?: () => Promise<void>;
}

export type CleanupFunction = () => void;

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
