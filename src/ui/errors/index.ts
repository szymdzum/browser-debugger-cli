/**
 * Error handling for bdg CLI.
 *
 * Provides structured error classes for both CLI commands and system-level operations.
 */

// CLI-level errors (user-facing command errors)
export { CommandError } from './CommandError.js';

// System-level errors (CDP, Chrome, timeouts)
export {
  BdgError,
  CDPConnectionError,
  ChromeLaunchError,
  CDPTimeoutError,
} from './SystemErrors.js';

// Utility functions
export { getErrorMessage, isDaemonConnectionError } from './utils.js';
