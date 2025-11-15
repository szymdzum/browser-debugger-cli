/**
 * IPC Message Type Constructors
 *
 * Generic types for constructing strongly-typed request/response messages
 * for both worker communication and client-daemon communication.
 */

import type { COMMANDS, CommandName } from './commands.js';

/**
 * Worker request message (daemon → worker).
 * Includes requestId for correlation.
 */
export type WorkerRequest<T extends CommandName> = {
  type: `${T}_request`;
  requestId: string;
} & (typeof COMMANDS)[T]['requestSchema'];

/**
 * Worker response message (worker → daemon).
 * Includes success flag and optional error.
 */
export type WorkerResponse<T extends CommandName> = {
  type: `${T}_response`;
  requestId: string;
  success: boolean;
  data?: (typeof COMMANDS)[T]['responseSchema'];
  error?: string;
};

/**
 * Client request message (CLI → daemon).
 * Includes sessionId for correlation.
 */
export type ClientRequest<T extends CommandName> = {
  type: `${T}_request`;
  sessionId: string;
} & (typeof COMMANDS)[T]['requestSchema'];

/**
 * Client response message (daemon → CLI).
 * Uses status instead of success for consistency with session messages.
 */
export type ClientResponse<T extends CommandName> = {
  type: `${T}_response`;
  sessionId: string;
  status: 'ok' | 'error';
  data?: (typeof COMMANDS)[T]['responseSchema'];
  error?: string;
};

/**
 * Union of all possible worker request types.
 */
export type WorkerRequestUnion = { [K in CommandName]: WorkerRequest<K> }[CommandName];

/**
 * Union of all possible worker response types.
 */
export type WorkerResponseUnion = { [K in CommandName]: WorkerResponse<K> }[CommandName];

/**
 * Union of all possible client request types.
 */
export type ClientRequestUnion = { [K in CommandName]: ClientRequest<K> }[CommandName];
