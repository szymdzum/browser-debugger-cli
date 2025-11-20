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
}

export interface ConsoleMessage {
  type: Protocol.Runtime.ConsoleAPICalledEvent['type'] | 'error';
  text: string;
  timestamp: number;
  args?: unknown[];
  navigationId?: number;
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
