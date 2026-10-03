/**
 * IPC Message Type Constructors
 *
 * Generic types for constructing strongly-typed request/response messages
 * for client-daemon communication.
 */

import type { COMMANDS, CommandName } from './commands.js';

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
 * On failure, semantic `exitCode` and `suggestion` from a `CommandError` are
 * preserved end-to-end so CLI-side handlers can stop guessing with hardcoded
 * fallback codes.
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
 * Union of all possible client request types.
 */
export type ClientRequestUnion = { [K in CommandName]: ClientRequest<K> }[CommandName];
