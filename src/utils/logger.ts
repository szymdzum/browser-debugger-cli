/**
 * Logging utilities for consistent formatted output.
 *
 * WHY: Centralizes log formatting to avoid repetitive `console.error('[component] message')` patterns.
 */

/**
 * Log contexts for different components.
 * Used to prefix log messages with component name.
 */
export type LogContext =
  | 'bdg'
  | 'launcher'
  | 'daemon'
  | 'worker'
  | 'client'
  | 'cleanup'
  | 'session'
  | 'chrome'
  | 'cdp'
  | 'ipc';

/**
 * Create a logger function for a specific context.
 *
 * WHY: Provides consistent log formatting with context prefix.
 *
 * @param context - Component context for log prefix
 * @returns Logger function that prefixes messages with context
 *
 * @example
 * ```typescript
 * const log = createLogger('cleanup');
 * log('Removed stale daemon socket');
 * // Output: [cleanup] Removed stale daemon socket
 * ```
 */
export function createLogger(context: LogContext): (message: string) => void {
  return (message: string) => {
    console.error(`[${context}] ${message}`);
  };
}

/**
 * Log a message with a specific context (one-off usage).
 *
 * WHY: Convenient for single log statements without creating a logger function.
 *
 * @param context - Component context for log prefix
 * @param message - Log message
 *
 * @example
 * ```typescript
 * log('cleanup', 'Removed stale daemon socket');
 * // Output: [cleanup] Removed stale daemon socket
 * ```
 */
export function log(context: LogContext, message: string): void {
  console.error(`[${context}] ${message}`);
}
