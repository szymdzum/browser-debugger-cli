/**
 * Type guards for runtime type validation.
 *
 * Provides type-safe validation of IPC response data, replacing unsafe
 * `as unknown as` type assertions with proper runtime checks.
 *
 * WHY: Type assertions bypass TypeScript's type system and can lead to
 * runtime errors. Type guards provide actual runtime validation while
 * maintaining type safety.
 */

import type { NetworkRequest, ConsoleMessage } from '@/types.js';
import { CommandError } from '@/ui/errors/index.js';
import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Type guard to check if a value is a valid NetworkRequest.
 *
 * Validates the presence of required NetworkRequest properties.
 *
 * @param value - Unknown value to validate
 * @returns True if value is a valid NetworkRequest
 *
 * @example
 * ```typescript
 * if (isNetworkRequest(item)) {
 *   console.log(item.url); // TypeScript knows item is NetworkRequest
 * }
 * ```
 */
export function isNetworkRequest(value: unknown): value is NetworkRequest {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record['requestId'] === 'string' &&
    typeof record['url'] === 'string' &&
    typeof record['method'] === 'string' &&
    typeof record['timestamp'] === 'number'
  );
}

/**
 * Type guard to check if a value is a valid ConsoleMessage.
 *
 * Validates the presence of required ConsoleMessage properties.
 *
 * @param value - Unknown value to validate
 * @returns True if value is a valid ConsoleMessage
 *
 * @example
 * ```typescript
 * if (isConsoleMessage(item)) {
 *   console.log(item.text); // TypeScript knows item is ConsoleMessage
 * }
 * ```
 */
export function isConsoleMessage(value: unknown): value is ConsoleMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record['type'] === 'string' &&
    typeof record['text'] === 'string' &&
    typeof record['timestamp'] === 'number'
  );
}

/**
 * Validate and return a details item with proper type safety.
 *
 * Replaces unsafe `as unknown as` assertions with runtime validation.
 * Throws CommandError if validation fails.
 *
 * Uses function overloads to return the correct type based on the `type` parameter,
 * enabling proper type narrowing in discriminated unions.
 *
 * @param item - Unknown item from IPC response
 * @param type - Expected type ('network' or 'console')
 * @returns Validated NetworkRequest or ConsoleMessage based on type parameter
 * @throws CommandError if item fails validation
 *
 * @example
 * ```typescript
 * const networkItem = validateDetailsItem(response.data.item, 'network');
 * // networkItem is typed as NetworkRequest
 *
 * const consoleItem = validateDetailsItem(response.data.item, 'console');
 * // consoleItem is typed as ConsoleMessage
 * ```
 */
export function validateDetailsItem(item: unknown, type: 'network'): NetworkRequest;
// eslint-disable-next-line no-redeclare
export function validateDetailsItem(item: unknown, type: 'console'): ConsoleMessage;
// eslint-disable-next-line no-redeclare
export function validateDetailsItem(
  item: unknown,
  type: 'network' | 'console'
): NetworkRequest | ConsoleMessage {
  if (!item || typeof item !== 'object') {
    throw new CommandError(
      'Invalid item data: expected an object',
      { suggestion: 'This may indicate corrupted data from the daemon' },
      EXIT_CODES.SESSION_FILE_ERROR
    );
  }

  if (type === 'network') {
    if (!isNetworkRequest(item)) {
      throw new CommandError(
        'Invalid network request data: missing required fields (requestId, url, method, timestamp)',
        { suggestion: 'The request data may be incomplete or corrupted' },
        EXIT_CODES.SESSION_FILE_ERROR
      );
    }
    return item;
  }

  if (!isConsoleMessage(item)) {
    throw new CommandError(
      'Invalid console message data: missing required fields (type, text, timestamp)',
      { suggestion: 'The console message data may be incomplete or corrupted' },
      EXIT_CODES.SESSION_FILE_ERROR
    );
  }
  return item;
}
