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
