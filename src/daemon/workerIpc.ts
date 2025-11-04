/**
 * Worker IPC Message Types
 *
 * Defines messages for bidirectional communication between daemon and worker process.
 * Communication uses JSONL format (JSON lines) via stdin/stdout.
 */

/**
 * Base message type for worker IPC
 */
export interface WorkerIPCMessage {
  type: string;
  requestId: string; // Unique ID to match requests with responses
}

/**
 * Worker ready signal sent from worker to daemon on startup
 */
export interface WorkerReadyMessage extends WorkerIPCMessage {
  type: 'worker_ready';
  workerPid: number;
  chromePid: number;
  port: number;
  target: {
    url: string;
    title?: string;
  };
}

/**
 * DOM query request sent from daemon to worker
 */
export interface WorkerDomQueryRequest extends WorkerIPCMessage {
  type: 'dom_query_request';
  selector: string;
}

/**
 * DOM query response sent from worker to daemon
 */
export interface WorkerDomQueryResponse extends WorkerIPCMessage {
  type: 'dom_query_response';
  success: boolean;
  data?: {
    selector: string;
    count: number;
    nodes: Array<{
      index: number;
      nodeId: number;
      tag?: string;
      classes?: string[];
      preview?: string;
    }>;
  };
  error?: string;
}

/**
 * DOM highlight request sent from daemon to worker
 */
export interface WorkerDomHighlightRequest extends WorkerIPCMessage {
  type: 'dom_highlight_request';
  selector?: string;
  index?: number;
  nodeId?: number;
  first?: boolean;
  nth?: number;
  color?: string;
  opacity?: number;
}

/**
 * DOM highlight response sent from worker to daemon
 */
export interface WorkerDomHighlightResponse extends WorkerIPCMessage {
  type: 'dom_highlight_response';
  success: boolean;
  data?: {
    highlighted: number;
    nodeIds: number[];
  };
  error?: string;
}

/**
 * DOM get request sent from daemon to worker
 */
export interface WorkerDomGetRequest extends WorkerIPCMessage {
  type: 'dom_get_request';
  selector?: string;
  index?: number;
  nodeId?: number;
  all?: boolean;
  nth?: number;
}

/**
 * DOM node information
 */
export interface WorkerDomNodeInfo {
  nodeId: number;
  tag?: string;
  attributes?: Record<string, string>;
  classes?: string[];
  outerHTML?: string;
}

/**
 * DOM get response sent from worker to daemon
 */
export interface WorkerDomGetResponse extends WorkerIPCMessage {
  type: 'dom_get_response';
  success: boolean;
  data?: {
    nodes: WorkerDomNodeInfo[];
  };
  error?: string;
}

/**
 * Union type of all worker IPC messages
 */
export type WorkerIPCMessageType =
  | WorkerReadyMessage
  | WorkerDomQueryRequest
  | WorkerDomQueryResponse
  | WorkerDomHighlightRequest
  | WorkerDomHighlightResponse
  | WorkerDomGetRequest
  | WorkerDomGetResponse;

/**
 * Union type of all requests sent from daemon to worker
 */
export type WorkerIPCRequest =
  | WorkerDomQueryRequest
  | WorkerDomHighlightRequest
  | WorkerDomGetRequest;

/**
 * Union type of all responses sent from worker to daemon
 */
export type WorkerIPCResponse =
  | WorkerReadyMessage
  | WorkerDomQueryResponse
  | WorkerDomHighlightResponse
  | WorkerDomGetResponse;
