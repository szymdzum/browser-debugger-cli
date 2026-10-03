/**
 * Daemon layer error classes.
 *
 * Provides structured error handling for daemon and configuration errors.
 */

import { EXIT_CODES } from '@/utils/exitCodes.js';

/**
 * Base class for all daemon-related errors.
 */
export class DaemonError extends Error {
  public readonly exitCode: number;
  public readonly code?: string;

  constructor(message: string, code?: string, exitCode: number = EXIT_CODES.SOFTWARE_ERROR) {
    super(message);
    this.name = 'DaemonError';
    this.exitCode = exitCode;
    if (code !== undefined) {
      this.code = code;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DaemonError);
    }
  }
}

/**
 * Configuration error.
 *
 * Thrown when session configuration is invalid or missing required fields.
 *
 * @example
 * ```typescript
 * throw new ConfigError(
 *   'Missing required field: url',
 *   'MISSING_CONFIG_FIELD'
 * );
 * ```
 */
export class ConfigError extends DaemonError {
  public override readonly name = 'ConfigError';

  constructor(message: string, code?: string) {
    super(message, code, EXIT_CODES.INVALID_ARGUMENTS);
  }
}

/**
 * Daemon startup error.
 *
 * Thrown when daemon fails to start (port conflicts, permissions, etc.).
 *
 * @example
 * ```typescript
 * throw new DaemonStartupError(
 *   'Failed to bind to socket',
 *   'SOCKET_BIND_FAILED'
 * );
 * ```
 */
export class DaemonStartupError extends DaemonError {
  public override readonly name = 'DaemonStartupError';

  constructor(message: string, code?: string) {
    super(message, code, EXIT_CODES.SOFTWARE_ERROR);
  }
}
