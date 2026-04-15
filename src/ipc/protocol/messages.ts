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
} & Omit<(typeof COMMANDS)[T]['requestSchema'], 'type' | 'requestId'>;

/**
 * Worker response message (worker → daemon).
 *
 * On failure the worker can propagate structured error semantics
 * (`exitCode`, `suggestion`) originating from a `CommandError`, so the CLI
 * can render the same exit code and recovery hint it would have produced
 * when running the operation locally.
 */
export type WorkerResponse<T extends CommandName> = {
  type: `${T}_response`;
  requestId: string;
  success: boolean;
  data?: (typeof COMMANDS)[T]['responseSchema'];
  error?: string;
  /** Semantic exit code forwarded from the handler (present on failure). */
  exitCode?: number;
  /** Recovery suggestion forwarded from the handler (present on failure). */
  suggestion?: string;
};

/**
 * Client request message (CLI → daemon).
 * Includes sessionId for correlation.
 */
export type ClientRequest<T extends CommandName> = {
  type: `${T}_request`;
  sessionId: string;
} & Omit<(typeof COMMANDS)[T]['requestSchema'], 'type' | 'sessionId'>;

/**
 * Client response message (daemon → CLI).
 *
 * Mirrors `WorkerResponse` in the error case: semantic `exitCode` and
 * `suggestion` are preserved end-to-end so CLI-side handlers can stop
 * guessing with hardcoded fallback codes.
 */
export type ClientResponse<T extends CommandName> = {
  type: `${T}_response`;
  sessionId: string;
  status: 'ok' | 'error';
  data?: (typeof COMMANDS)[T]['responseSchema'];
  error?: string;
  /** Semantic exit code forwarded from the handler (present on failure). */
  exitCode?: number;
  /** Recovery suggestion forwarded from the handler (present on failure). */
  suggestion?: string;
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
