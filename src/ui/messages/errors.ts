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
 * Generate "no preview data available" error message.
 *
 * @returns Formatted error message with suggestions
 *
 * @example
 * ```typescript
 * console.error(noPreviewDataError());
 * ```
 */
export function noPreviewDataError(): string {
  return `Error: No active session found
No preview data available

Start a session with: bdg <url>
Check session status: bdg status`;
}

/**
 * Generate "invalid CDP response" error message.
 *
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * throw new Error(invalidCDPResponseError());
 * ```
 */
export function invalidCDPResponseError(): string {
  return 'Invalid response from CDP';
}
