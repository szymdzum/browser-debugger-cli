/**
 * Legacy system error classes (deprecated).
 *
 * This file will be removed. Domain errors have been moved to their respective modules.
 * Use connection/errors.ts for CDP and Chrome errors.
 */

/**
 * Base error class for all bdg system errors (legacy).
 *
 * No longer used. Domain modules define their own error base classes.
 *
 * Extends native Error with error codes for programmatic handling,
 * category for filtering, exit codes for semantic exit codes,
 * and cause chaining for nested errors.
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
