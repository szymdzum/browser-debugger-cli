/**
 * Type Guards for IPC Protocol
 *
 * Runtime type guards for identifying message types.
 */

import { COMMANDS, type CommandName } from './commands.js';

/**
 * Check if a message type is a command request.
 *
 * @param type - Message type string
 * @returns True if type matches pattern {command_name}_request
 *
 * @example
 * ```typescript
 * isCommandRequest('worker_peek_request') // true
 * isCommandRequest('status_request')      // false
 * ```
 */
export function isCommandRequest(type: string): type is `${CommandName}_request` {
  const commandName = type.replace('_request', '') as CommandName;
  return commandName in COMMANDS;
}

/**
 * Check if a message type is a command response.
 *
 * @param type - Message type string
 * @returns True if type matches pattern {command_name}_response
 *
 * @example
 * ```typescript
 * isCommandResponse('worker_peek_response') // true
 * isCommandResponse('status_response')      // false
 * ```
 */
export function isCommandResponse(type: string): type is `${CommandName}_response` {
  const commandName = type.replace('_response', '') as CommandName;
  return commandName in COMMANDS;
}

/**
 * Extract command name from a message type string.
 *
 * @param type - Message type string (request or response)
 * @returns Command name if valid, null otherwise
 *
 * @example
 * ```typescript
 * getCommandName('worker_peek_request')  // 'worker_peek'
 * getCommandName('worker_peek_response') // 'worker_peek'
 * getCommandName('status_request')       // null
 * ```
 */
export function getCommandName(type: string): CommandName | null {
  const commandName = type.replace(/_request|_response/, '') as CommandName;
  return commandName in COMMANDS ? commandName : null;
}
