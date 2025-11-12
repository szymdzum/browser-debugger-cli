/**
 * Error handling for bdg CLI.
 *
 * Provides structured error classes for CLI commands and re-exports domain errors.
 */

// CLI-level errors (user-facing command errors)
export { CommandError } from './CommandError.js';

// Re-export connection errors for backward compatibility (deprecated - import from @/connection/errors instead)
export {
  CDPConnectionError,
  ChromeLaunchError,
  CDPTimeoutError,
  getErrorMessage,
} from '@/connection/errors.js';

// Utility functions
export { isDaemonConnectionError } from './utils.js';
