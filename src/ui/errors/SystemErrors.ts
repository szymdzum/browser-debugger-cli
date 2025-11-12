/**
 * Legacy system error classes (deprecated).
 *
 * @deprecated This file will be removed. Domain errors have been moved to their respective modules:
 * - CDP/Chrome errors: @/connection/errors.ts
 * - Daemon errors: @/daemon/errors.ts (future)
 * - Session errors: @/session/errors.ts (future)
 */

/**
 * Base error class for all bdg system errors (legacy).
 *
 * @deprecated No longer used. Domain modules define their own error base classes.
 *
 * Extends native Error with:
 * - Error codes for programmatic handling
 * - Category for filtering (system/user/external)
 * - Exit code for semantic exit codes (80-99 user errors, 100-119 software errors)
 * - Cause chaining for nested errors
 */
export abstract class BdgError extends Error {
  abstract readonly code: string;
  abstract readonly category: 'system' | 'user' | 'external';
  abstract readonly exitCode: number;

  constructor(message: string, cause?: Error) {
    super(message);
    this.name = this.constructor.name;
    this.cause = cause;
  }
}
