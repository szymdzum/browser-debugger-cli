/**
 * Unified Command Registry - Single Source of Truth
 *
 * This file defines all IPC commands and their schemas. Command types are defined once here,
 * and utility types add sessionId/requestId at the boundaries (client/worker).
 *
 * Benefits:
 * - No type duplication between client and worker
 * - Adding a new command only requires updating this file and the handler
 * - Type safety maintained throughout the stack
 */

// =============================================================================
// Command Schemas (Base Types - No IDs)
// =============================================================================

/**
 * Worker Peek Command - Get lightweight preview of collected data
 */
export interface WorkerPeekCommand {
  lastN?: number; // Limit to last N items (default: 10)
}

export interface WorkerPeekData {
  version: string;
  startTime: number;
  duration: number;
  target: {
    url: string;
    title: string;
  };
  activeTelemetry: string[];
  network: Array<{
    requestId: string;
    timestamp: number;
    method: string;
    url: string;
    status?: number;
    mimeType?: string;
  }>;
  console: Array<{
    timestamp: number;
    type: string;
    text: string;
  }>;
}

/**
 * Worker Details Command - Get full object for specific network/console item
 */
export interface WorkerDetailsCommand {
  itemType: 'network' | 'console';
  id: string; // requestId for network, index for console
}

export interface WorkerDetailsData {
  item: unknown; // NetworkRequest | ConsoleMessage (full object)
}

/**
 * CDP Call Command - Execute arbitrary CDP method
 */
export interface CdpCallCommand {
  method: string; // CDP method (e.g., 'Network.getCookies', 'Runtime.evaluate')
  params?: Record<string, unknown>; // CDP method parameters
}

export interface CdpCallData {
  result: unknown; // CDP method result (varies by method)
}

/**
 * Worker Status Command - Get live activity metrics from worker
 *
 * Returns real-time session activity including network request counts,
 * console message counts, last activity timestamps, and current page state.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface WorkerStatusCommand {
  // No parameters needed - just returns current state
}

export interface WorkerStatusData {
  /** Session start timestamp (milliseconds since epoch) */
  startTime: number;
  /** Session duration in milliseconds */
  duration: number;
  /** Current page information */
  target: {
    url: string;
    title: string;
  };
  /** Active telemetry modules (network, console, dom) */
  activeTelemetry: string[];
  /** Real-time activity metrics */
  activity: {
    networkRequestsCaptured: number;
    consoleMessagesCaptured: number;
    lastNetworkRequestAt?: number;
    lastConsoleMessageAt?: number;
  };
}

// =============================================================================
// Command Registry - Single Source of Truth
// =============================================================================

/**
 * Registry of all available commands.
 * Each command has a request schema and response schema.
 */
export const COMMANDS = {
  worker_peek: {
    requestSchema: {} as WorkerPeekCommand,
    responseSchema: {} as WorkerPeekData,
  },
  worker_details: {
    requestSchema: {} as WorkerDetailsCommand,
    responseSchema: {} as WorkerDetailsData,
  },
  worker_status: {
    requestSchema: {} as WorkerStatusCommand,
    responseSchema: {} as WorkerStatusData,
  },
  cdp_call: {
    requestSchema: {} as CdpCallCommand,
    responseSchema: {} as CdpCallData,
  },
} as const;

export type CommandSchemas = typeof COMMANDS;

export type CommandName = keyof typeof COMMANDS;

// =============================================================================
// Utility Types - Add IDs at Boundaries
// =============================================================================

/**
 * Worker Request - Command with requestId (daemon -\> worker via stdin)
 */
export type WorkerRequest<T extends CommandName> = {
  type: `${T}_request`;
  requestId: string;
} & (typeof COMMANDS)[T]['requestSchema'];

/**
 * Worker Response - Command result with requestId (worker -\> daemon via stdout)
 */
export type WorkerResponse<T extends CommandName> = {
  type: `${T}_response`;
  requestId: string;
  success: boolean;
  data?: (typeof COMMANDS)[T]['responseSchema'];
  error?: string;
};

/**
 * Client Request - Command with sessionId (CLI -\> daemon via Unix socket)
 */
export type ClientRequest<T extends CommandName> = {
  type: `${T}_request`;
  sessionId: string;
} & (typeof COMMANDS)[T]['requestSchema'];

/**
 * Client Response - Command result with sessionId (daemon -\> CLI via Unix socket)
 */
export type ClientResponse<T extends CommandName> = {
  type: `${T}_response`;
  sessionId: string;
  status: 'ok' | 'error';
  data?: (typeof COMMANDS)[T]['responseSchema'];
  error?: string;
};

// =============================================================================
// Union Types for Message Parsing
// =============================================================================

/**
 * Union of all possible worker request types
 */
export type WorkerRequestUnion = {
  [K in CommandName]: WorkerRequest<K>;
}[CommandName];

/**
 * Union of all possible worker response types
 */
export type WorkerResponseUnion = {
  [K in CommandName]: WorkerResponse<K>;
}[CommandName];

/**
 * Union of all possible client request types
 */
export type ClientRequestUnion = {
  [K in CommandName]: ClientRequest<K>;
}[CommandName];

// =============================================================================
// Type Guards
// =============================================================================

/**
 * Check if a message type corresponds to a registered command
 */
export function isCommandRequest(type: string): type is `${CommandName}_request` {
  const commandName = type.replace('_request', '') as CommandName;
  return commandName in COMMANDS;
}

/**
 * Check if a message type corresponds to a command response
 */
export function isCommandResponse(type: string): type is `${CommandName}_response` {
  const commandName = type.replace('_response', '') as CommandName;
  return commandName in COMMANDS;
}

/**
 * Extract command name from message type
 */
export function getCommandName(type: string): CommandName | null {
  const commandName = type.replace(/_request|_response/, '') as CommandName;
  return commandName in COMMANDS ? commandName : null;
}
