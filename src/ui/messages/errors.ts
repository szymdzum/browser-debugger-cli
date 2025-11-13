/**
 * Common error messages and patterns.
 *
 * Centralized location for reusable error messages with consistent formatting.
 */

import { formatDuration } from '@/ui/formatting.js';

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
  const lines: string[] = [];

  lines.push('');
  lines.push('Error: Session already running');
  lines.push('');
  lines.push(`  PID:      ${pid}`);
  if (targetUrl) {
    lines.push(`  Target:   ${targetUrl}`);
  }
  lines.push(`  Duration: ${formatDuration(duration)}`);
  lines.push('');
  lines.push('Suggestions:');
  lines.push('  View session:     bdg status');
  lines.push('  Stop and restart: bdg stop && bdg <url>');
  lines.push('');

  return lines.join('\n');
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
  const lines: string[] = [];

  lines.push('Error: Daemon not running');

  if (context?.staleCleanedUp) {
    lines.push('(Stale PID file was cleaned up)');
  }

  if (context?.lastError) {
    lines.push(`Last error: ${context.lastError}`);
  }

  lines.push('');
  lines.push('Start a new session:');
  lines.push('  bdg <url>');

  if (context?.suggestStatus) {
    lines.push('');
    lines.push('Or check daemon status:');
    lines.push('  bdg status');
  }

  if (context?.suggestRetry) {
    lines.push('');
    lines.push('Or try the command again if this was transient');
  }

  return lines.join('\n');
}

/**
 * @deprecated Use daemonNotRunningError() instead
 * Generate "daemon connection failed" error message.
 *
 * @returns Formatted error message with troubleshooting
 *
 * @example
 * ```typescript
 * console.error(daemonConnectionFailedError());
 * ```
 */
export function daemonConnectionFailedError(): string {
  return daemonNotRunningError({ suggestStatus: true, suggestRetry: true });
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
