/**
 * Logging utilities for consistent formatted output with log level support.
 *
 * WHY: Centralizes log formatting and enables debug mode for verbose logging.
 * By default, only 'info' level logs are shown. Set BDG_DEBUG=1 or use --debug
 * flag to enable verbose 'debug' level logs.
 */

// ============================================================================
// Global Debug State
// ============================================================================

let debugEnabled = false;

/**
 * Enable debug logging globally.
 *
 * This is typically called during CLI initialization when --debug flag is detected.
 * Debug mode shows all logs including verbose internal state changes and tracing.
 */
export function enableDebugLogging(): void {
  debugEnabled = true;
}

/**
 * Check if debug logging is currently enabled.
 *
 * @returns True if debug mode is active
 */
export function isDebugEnabled(): boolean {
  return debugEnabled || process.env['BDG_DEBUG'] === '1';
}

// ============================================================================
// Log Levels
// ============================================================================

/**
 * Log level determines visibility of log messages.
 *
 * - 'info': Always shown (important user-facing messages, errors, key milestones)
 * - 'debug': Only shown in debug mode (verbose internal state, IPC traces, progress updates)
 */
export type LogLevel = 'info' | 'debug';

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

// ============================================================================
// Logger Interface
// ============================================================================

/**
 * Logger instance with support for different log levels.
 */
export interface Logger {
  /**
   * Log an info message (always shown).
   * Use for important user-facing messages and key milestones.
   */
  info: (message: string) => void;

  /**
   * Log a debug message (only shown in debug mode).
   * Use for verbose internal state, progress updates, and traces.
   */
  debug: (message: string) => void;

  /**
   * Log a message (defaults to info level).
   * Provided for backward compatibility.
   */
  (message: string): void;
}

// ============================================================================
// Logger Implementation
// ============================================================================

/**
 * Create a logger instance for a specific context.
 *
 * WHY: Provides consistent log formatting with context prefix and level support.
 * By default, ALL logs are hidden unless --debug flag or BDG_DEBUG=1 is set.
 * This keeps normal output clean and only shows logs when debugging.
 *
 * @param context - Component context for log prefix
 * @returns Logger instance with info/debug methods
 *
 * @example
 * ```typescript
 * const log = createLogger('cleanup');
 *
 * // Always shown (even without --debug)
 * log.info('Cleaned up stale session files');
 *
 * // Only shown in debug mode (--debug or BDG_DEBUG=1)
 * log.debug('Checking PID file at ~/.bdg/daemon.pid');
 *
 * // Backward compatible (treated as debug - only shown in debug mode)
 * log('Daemon started successfully');
 * ```
 */
export function createLogger(context: LogContext): Logger {
  const logMessage = (message: string, level: LogLevel = 'debug'): void => {
    if (level === 'debug' && !isDebugEnabled()) {
      return;
    }
    console.error(`[${context}] ${message}`);
  };

  const logger = ((message: string) => logMessage(message, 'debug')) as Logger;
  logger.info = (message: string) => logMessage(message, 'info');
  logger.debug = (message: string) => logMessage(message, 'debug');

  return logger;
}

/**
 * Log a message with a specific context (one-off usage).
 *
 * WHY: Convenient for single log statements without creating a logger instance.
 *
 * @param context - Component context for log prefix
 * @param message - Log message
 * @param level - Log level (defaults to 'debug' - only shown with --debug)
 *
 * @example
 * ```typescript
 * // Always shown (even without --debug)
 * log('cleanup', 'Removed stale daemon socket', 'info');
 *
 * // Only shown in debug mode (default behavior)
 * log('cleanup', 'Found PID file');
 * log('cleanup', 'Checking lock file', 'debug');
 * ```
 */
export function log(context: LogContext, message: string, level: LogLevel = 'debug'): void {
  if (level === 'debug' && !isDebugEnabled()) {
    return;
  }
  console.error(`[${context}] ${message}`);
}
