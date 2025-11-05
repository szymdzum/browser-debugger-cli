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
 * Generate "daemon not running" error message.
 *
 * @returns Formatted error message with suggestion
 *
 * @example
 * ```typescript
 * console.error(daemonNotRunningError());
 * ```
 */
export function daemonNotRunningError(): string {
  const lines: string[] = [];
  lines.push('Error: Daemon not running');
  lines.push('Start it with: bdg <url>');
  return lines.join('\n');
}

/**
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
  const lines: string[] = [];
  lines.push('[bdg] Daemon not running');
  lines.push('[bdg] Try running the command again or check daemon status with: bdg status');
  return lines.join('\n');
}

/**
 * Generate validation error message with optional provided value.
 *
 * @param message - Error message describing the validation failure
 * @param providedValue - Optional value that failed validation
 * @returns Formatted error message
 *
 * @example
 * ```typescript
 * const message = validationError('--last must be between 1 and 1000', 5000);
 * console.error(message);
 * // Error: --last must be between 1 and 1000
 * // Provided value: 5000
 * ```
 */
export function validationError(message: string, providedValue?: unknown): string {
  const lines: string[] = [];
  lines.push(`Error: ${message}`);
  if (providedValue !== undefined) {
    const valueStr =
      typeof providedValue === 'string' ? providedValue : JSON.stringify(providedValue);
    lines.push(`Provided value: ${valueStr}`);
  }
  return lines.join('\n');
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
