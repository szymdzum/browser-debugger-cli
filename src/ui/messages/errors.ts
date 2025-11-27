/**
 * Common error messages and patterns.
 *
 * Centralized location for reusable error messages with consistent formatting.
 */

import { formatDuration, joinLines } from '@/ui/formatting.js';

/**
 * Generate "session already running" error message.
 *
 * @param pid - Process ID of running session
 * @param duration - Session duration in milliseconds
 * @param targetUrl - Optional target URL to show
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * const message = sessionAlreadyRunningError(12345, 60000, 'http://localhost:3000');
 * console.error(message);
 * ```
 */
export function sessionAlreadyRunningError(
  pid: number,
  duration: number,
  targetUrl?: string
): string {
  return joinLines(
    '',
    'Error: Session already running',
    '',
    `  PID:      ${pid}`,
    targetUrl && `  Target:   ${targetUrl}`,
    `  Duration: ${formatDuration(duration)}`,
    '',
    'Suggestions:',
    '  View session:     bdg status',
    '  Stop and restart: bdg stop && bdg <url>',
    ''
  );
}

/**
 * Context for daemon error messages.
 */
export interface DaemonErrorContext {
  /** Whether stale PID file was cleaned up */
  staleCleanedUp?: boolean;
  /** Whether to suggest checking status (for commands that expect daemon) */
  suggestStatus?: boolean;
  /** Whether to suggest retrying (for transient errors) */
  suggestRetry?: boolean;
  /** Last error message if available */
  lastError?: string;
}

/**
 * Generate unified "daemon not running" error message with context.
 *
 * This replaces the three previous variants:
 * - daemonNotRunningError()
 * - daemonConnectionFailedError()
 * - daemonNotRunningWithCleanup()
 *
 * @param context - Optional context about the error
 * @returns Formatted error message with suggestions
 *
 * @example
 * ```typescript
 * // Basic usage
 * console.error(daemonNotRunningError());
 *
 * // With stale cleanup
 * console.error(daemonNotRunningError({ staleCleanedUp: true }));
 *
 * // With status suggestion
 * console.error(daemonNotRunningError({ suggestStatus: true }));
 * ```
 */
export function daemonNotRunningError(context?: DaemonErrorContext): string {
  return joinLines(
    'Error: Daemon not running',
    context?.staleCleanedUp && '(Stale PID file was cleaned up)',
    context?.lastError && `Last error: ${context.lastError}`,
    '',
    'Start a new session:',
    '  bdg <url>',
    context?.suggestStatus && '',
    context?.suggestStatus && 'Or check daemon status:',
    context?.suggestStatus && '  bdg status',
    context?.suggestRetry && '',
    context?.suggestRetry && 'Or try the command again if this was transient'
  );
}

/**
 * Generate generic error message with optional context.
 *
 * @param message - Error message
 * @param context - Optional additional context
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * console.error(genericError('Operation failed', 'Network timeout'));
 * ```
 */
export function genericError(message: string, context?: string): string {
  if (context) {
    return `Error: ${message}\n${context}`;
  }
  return `Error: ${message}`;
}

/**
 * Generate "unknown error" message.
 *
 * @returns Formatted error message
 */
export function unknownError(): string {
  return 'Error: Unknown error';
}

/**
 * Generate "invalid response" error message.
 *
 * @param reason - Reason for invalid response
 * @returns Formatted error message
 */
export function invalidResponseError(reason: string): string {
  return `[bdg] Invalid response from daemon: ${reason}`;
}

/**
 * Generate session not active error with state-aware suggestion.
 *
 * Provides context-appropriate guidance based on what operation was attempted.
 *
 * @param operation - Operation that was attempted (e.g., "peek", "dom query")
 * @returns Formatted error message with suggestions
 *
 * @example
 * ```typescript
 * throw new CommandError(
 *   sessionNotActiveError('peek'),
 *   {},
 *   EXIT_CODES.RESOURCE_NOT_FOUND
 * );
 * ```
 */
export function sessionNotActiveError(operation: string): string {
  return joinLines(
    `Error: Cannot ${operation} - no active session`,
    '',
    'Start a session first:',
    '  bdg <url>',
    '',
    'Example:',
    '  bdg https://example.com',
    `  bdg ${operation}`
  );
}

/**
 * Generate element not found error with CDP fallback.
 *
 * Provides guidance for when high-level DOM commands fail to find elements,
 * including CDP alternatives for complex queries.
 *
 * @param selector - CSS selector that failed
 * @returns Formatted error message with fallback suggestions
 *
 * @example
 * ```typescript
 * throw new CommandError(
 *   elementNotFoundError('#missing-element'),
 *   { cdpAlternative: 'Use Runtime.evaluate for complex queries' },
 *   EXIT_CODES.RESOURCE_NOT_FOUND
 * );
 * ```
 */
export function elementNotFoundError(selector: string): string {
  return joinLines(
    `Error: Element not found: ${selector}`,
    '',
    'Suggestions:',
    '  - Check the selector syntax',
    '  - Wait for the element to load (page might still be loading)',
    '  - Use bdg peek to see if page loaded correctly',
    '',
    'Advanced: Use CDP for complex queries:',
    `  bdg cdp Runtime.evaluate --params '{"expression":"document.querySelector('${selector}')"}'`
  );
}

/**
 * Error with suggestion pair for CommandError usage.
 */
export interface ErrorWithSuggestion {
  message: string;
  suggestion: string;
}

/**
 * Index out of range error.
 */
export function indexOutOfRangeError(index: number, max: number): ErrorWithSuggestion {
  return {
    message: `Index ${index} out of range (found ${max + 1} nodes)`,
    suggestion: `Use an index between 0 and ${max}`,
  };
}

/**
 * Element at index not found (stale cache).
 */
export function elementAtIndexNotFoundError(index: number, selector: string): ErrorWithSuggestion {
  return {
    message: `Element at index ${index} not found`,
    suggestion: `Re-run "bdg dom query ${selector}" to refresh the cache`,
  };
}

/**
 * No nodes found for selector.
 */
export function noNodesFoundError(selector: string): ErrorWithSuggestion {
  return {
    message: `No nodes found matching "${selector}"`,
    suggestion: 'Verify the CSS selector is correct',
  };
}

/**
 * Element not visible/rendered.
 */
export function elementNotVisibleError(): ErrorWithSuggestion {
  return {
    message: 'Failed to get element bounds',
    suggestion: 'Element may not be rendered or visible',
  };
}

/**
 * Element has zero dimensions.
 */
export function elementZeroDimensionsError(): ErrorWithSuggestion {
  return {
    message: 'Element has zero dimensions (not visible)',
    suggestion: 'Element may be hidden or collapsed',
  };
}

/**
 * Missing required argument.
 */
export function missingArgumentError(usage: string): ErrorWithSuggestion {
  return {
    message: 'Missing required argument or flag',
    suggestion: usage,
  };
}

/**
 * Either/or argument required.
 */
export function eitherArgumentRequiredError(
  arg1: string,
  arg2: string,
  example: string
): ErrorWithSuggestion {
  return {
    message: `Either ${arg1} or ${arg2} must be provided`,
    suggestion: example,
  };
}

/**
 * Invalid query pattern.
 */
export function invalidQueryPatternError(pattern: string): ErrorWithSuggestion {
  return {
    message: 'Query pattern must specify at least one field',
    suggestion: `Received: "${pattern}". Try: bdg dom a11y query "role:button" or "name:Submit"`,
  };
}

/**
 * No a11y nodes matching pattern.
 */
export function noA11yNodesFoundError(pattern: string): ErrorWithSuggestion {
  return {
    message: 'No nodes found matching pattern',
    suggestion: `Pattern: ${pattern}. Try a broader query or use "bdg dom a11y tree" to see all elements`,
  };
}

/**
 * Element not accessible (a11y).
 */
export function elementNotAccessibleError(index: number): ErrorWithSuggestion {
  return {
    message: `Element at index ${index} not accessible`,
    suggestion: 'Re-run query to refresh cache',
  };
}

/**
 * Fillable element not found.
 */
export function fillableElementNotFoundError(selector: string): ErrorWithSuggestion {
  return {
    message: `Element not found: ${selector}`,
    suggestion: 'Verify the selector matches a fillable element (input, textarea, select)',
  };
}

/**
 * Clickable element not found.
 */
export function clickableElementNotFoundError(selector: string): ErrorWithSuggestion {
  return {
    message: `Element not found: ${selector}`,
    suggestion: 'Verify the selector matches a clickable element',
  };
}

/**
 * Key press failed.
 */
export function keyPressFailedError(details: string): ErrorWithSuggestion {
  return {
    message: 'Failed to press key',
    suggestion: details,
  };
}

/**
 * Session target not found.
 */
export function sessionTargetNotFoundError(): ErrorWithSuggestion {
  return {
    message: 'Session target not found (tab may have been closed)',
    suggestion: 'Start a new session with: bdg <url>',
  };
}

/**
 * Session metadata missing.
 */
export function sessionMetadataMissingError(field: string): ErrorWithSuggestion {
  return {
    message: `Session metadata missing ${field}`,
    suggestion: 'Start a new session with: bdg <url>',
  };
}

/**
 * Script execution error.
 */
export function scriptExecutionError(details: string): ErrorWithSuggestion {
  return {
    message: details,
    suggestion: 'Check JavaScript syntax and ensure the expression is valid',
  };
}

/**
 * Unexpected CDP response format.
 */
export function unexpectedResponseFormatError(context: string): ErrorWithSuggestion {
  return {
    message: 'Unexpected response format',
    suggestion: `CDP response missing result.value or invalid ${context} structure`,
  };
}

/**
 * Generic operation failure with dynamic error message.
 */
export function operationFailedError(operation: string, errorMessage: string): ErrorWithSuggestion {
  return {
    message: `Failed to ${operation}`,
    suggestion: errorMessage,
  };
}

/**
 * Internal error (should not happen in normal usage).
 */
export function internalError(context: string): ErrorWithSuggestion {
  return {
    message: context,
    suggestion: 'This is an internal error - please report this issue',
  };
}
