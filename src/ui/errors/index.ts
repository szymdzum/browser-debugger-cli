/**
 * Error handling for bdg CLI.
 *
 * Provides structured error classes for CLI commands.
 */

// CLI-level errors (user-facing command errors)
export { CommandError } from './CommandError.js';

// Utility functions
export { isDaemonConnectionError } from './utils.js';
