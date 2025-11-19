/**
 * Error handling for bdg CLI.
 *
 * Provides structured error classes for CLI commands.
 */

export { CommandError, type ErrorMetadata } from './CommandError.js';

export { isDaemonConnectionError } from './utils.js';
