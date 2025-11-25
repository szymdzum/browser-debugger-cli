import type { Protocol } from '@/connection/typed-cdp.js';

/**
 * Re-export connection types for backward compatibility.
 *
 * These types are now defined in connection/connectionTypes.ts for better cohesion.
 * This re-export maintains backward compatibility with existing code.
 */
export type {
  CDPMessage,
  CDPTarget,
  ConnectionOptions,
  LaunchedChrome,
  Logger,
  CleanupFunction,
} from '@/connection/types.js';

export interface DOMData {
  url: string;
  title: string;
  outerHTML: string;
  a11yTree?: {
    root: A11yNode;
    nodes: Record<string, A11yNode>;
    count: number;
  };
}

/**
 * WebSocket frame data captured during connection.
 */
export interface WebSocketFrame {
  /** Timestamp when frame was sent/received */
  timestamp: number;
  /** Direction: 'sent' or 'received' */
  direction: 'sent' | 'received';
  /** WebSocket opcode (1 = text, 2 = binary) */
  opcode: number;
  /** Frame payload data */
  payloadData: string;
}

/**
 * WebSocket connection with lifecycle and frame data.
 */
export interface WebSocketConnection {
  /** Request ID from CDP */
  requestId: string;
  /** WebSocket URL */
  url: string;
  /** Timestamp when connection was created */
  timestamp: number;
  /** Initiator URL (page that opened the WebSocket) */
  initiatorUrl?: string;
  /** Response status from handshake */
  status?: number;
  /** Response headers from handshake */
  responseHeaders?: Record<string, string>;
  /** Captured frames (sent and received) */
  frames: WebSocketFrame[];
  /** Timestamp when connection was closed */
  closedTime?: number;
  /** Error message if connection failed */
  errorMessage?: string;
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  timestamp: number;
  status?: number;
  mimeType?: string;
  /**
   * CDP resource type classification (Document, XHR, Script, Image, etc.)
   * Enables filtering and identification of request types.
   * Captured from Network.requestWillBeSent and Network.responseReceived events.
   */
  resourceType?: Protocol.Network.ResourceType;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  requestBody?: string;
  responseBody?: string;
  navigationId?: number;
  timing?: {
    requestTime?: number;
    proxyStart?: number;
    proxyEnd?: number;
    dnsStart?: number;
    dnsEnd?: number;
    connectStart?: number;
    connectEnd?: number;
    sslStart?: number;
    sslEnd?: number;
    workerStart?: number;
    workerReady?: number;
    workerFetchStart?: number;
    workerRespondWithSettled?: number;
    sendStart?: number;
    sendEnd?: number;
    pushStart?: number;
    pushEnd?: number;
    receiveHeadersEnd?: number;
  };
  loadingFinishedTime?: number;
  encodedDataLength?: number;
  decodedBodyLength?: number;
  serverIPAddress?: string;
  connection?: string;
  /**
   * Network error text from loadingFailed events.
   * Contains specific error codes like net::ERR_CERT_DATE_INVALID, net::ERR_CONNECTION_REFUSED.
   */
  errorText?: string;
  /**
   * Whether the request was canceled (e.g., navigation away, fetch abort).
   */
  canceled?: boolean;
  /**
   * Whether the request was blocked (e.g., CORS, mixed content).
   */
  blocked?: boolean;
  /**
   * Reason for blocking (e.g., 'cors', 'mixed-content', 'inspector').
   */
  blockedReason?: string;
}

/**
 * Stack frame representing a location in source code.
 * Used for error stack traces and source locations in console messages.
 */
export interface StackFrame {
  /** Source file URL or path */
  url: string;
  /** 0-based line number in the source */
  lineNumber: number;
  /** 0-based column number in the source */
  columnNumber: number;
  /** Function name, if available */
  functionName?: string;
  /** Script ID from CDP */
  scriptId?: string;
}

export interface ConsoleMessage {
  type: Protocol.Runtime.ConsoleAPICalledEvent['type'] | 'error';
  text: string;
  timestamp: number;
  args?: unknown[];
  navigationId?: number;
  /**
   * Stack trace captured when the console call was made.
   * First frame indicates the source location of the console call.
   */
  stackTrace?: StackFrame[];
}

/**
 * Console message level categories for user-facing filtering.
 * Used by --level option in console command.
 */
export type ConsoleLevel = 'error' | 'warning' | 'info' | 'debug';

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
    websockets?: WebSocketConnection[];
  };
  error?: string;
  partial?: boolean; // Flag to indicate this is partial/incomplete data (live preview)
}

export type TelemetryType = 'dom' | 'network' | 'console';

/**
 * Accessibility tree node with filtered and formatted data.
 *
 * This is a simplified representation of Protocol.Accessibility.AXNode
 * optimized for agent consumption and semantic queries.
 */
export interface A11yNode {
  /** Unique node identifier from CDP */
  nodeId: string;
  /** ARIA role (button, textbox, heading, etc.) */
  role: string;
  /** Accessible name (computed label) */
  name?: string;
  /** Accessible description */
  description?: string;
  /** Node value (for inputs, textareas, etc.) */
  value?: string;
  /** Whether node is focusable */
  focusable?: boolean;
  /** Whether node is currently focused */
  focused?: boolean;
  /** Whether node is disabled */
  disabled?: boolean;
  /** Whether field is required (forms) */
  required?: boolean;
  /** Additional ARIA properties */
  properties?: Record<string, unknown>;
  /** Child node IDs */
  childIds?: string[];
  /** Associated DOM node ID for querying */
  backendDOMNodeId?: number;
  /** True when node is synthesized from DOM context (a11y unavailable) */
  inferred?: boolean;
}

/**
 * Accessibility tree data structure.
 */
export interface A11yTree {
  /** Root node of the tree */
  root: A11yNode;
  /** All nodes indexed by nodeId for fast lookup */
  nodes: Map<string, A11yNode>;
  /** Total node count */
  count: number;
}

/**
 * Query pattern for searching accessibility tree.
 *
 * @example
 * ```typescript
 * { role: 'button', name: 'Submit' }
 * { role: 'textbox' }
 * { name: 'Email' }
 * ```
 */
export interface A11yQueryPattern {
  /** Filter by ARIA role */
  role?: string;
  /** Filter by accessible name (case-insensitive) */
  name?: string;
  /** Filter by accessible description (case-insensitive) */
  description?: string;
}

/**
 * Result from A11y query operation.
 */
export interface A11yQueryResult {
  /** Matching nodes */
  nodes: A11yNode[];
  /** Total matches found */
  count: number;
  /** Query pattern used */
  pattern: A11yQueryPattern;
}

/**
 * DOM context information for enriching semantic output.
 * Used when a11y name is missing to provide useful element context.
 */
export interface DomContext {
  tag: string;
  classes?: string[];
  preview?: string;
}

/**
 * Result of a DOM query operation.
 */
export interface DomQueryResult {
  selector: string;
  count: number;
  nodes: Array<{
    index: number;
    nodeId: number;
    tag?: string;
    classes?: string[];
    preview?: string;
  }>;
  /** Navigation ID when query was performed (for staleness detection). */
  navigationId?: number;
}

/**
 * Result of a DOM get operation.
 */
export interface DomGetResult {
  nodes: Array<{
    nodeId: number;
    tag?: string;
    attributes?: Record<string, unknown>;
    classes?: string[];
    outerHTML?: string;
  }>;
}

/**
 * Result of a screenshot operation.
 */
export interface ScreenshotResult {
  path: string;
  format: 'png' | 'jpeg';
  quality?: number;
  width: number;
  height: number;
  size: number;
  viewport?: {
    width: number;
    height: number;
  };
  fullPage: boolean;
}

/**
 * Options for DOM get operation.
 */
export interface DomGetOptions {
  selector?: string;
  nodeId?: number;
  all?: boolean;
  nth?: number;
}

/**
 * Options for screenshot operation.
 */
export interface ScreenshotOptions {
  format?: 'png' | 'jpeg';
  quality?: number;
  fullPage?: boolean;
}
