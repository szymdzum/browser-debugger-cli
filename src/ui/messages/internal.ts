/**
 * Internal system messages for session management operations.
 *
 * User-facing messages for internal operations like cache writes,
 * process management, and file system operations that may fail
 * but shouldn't stop execution.
 */

// ============================================================================
// Cache Messages
// ============================================================================

/**
 * Generate warning for failed DOM cache write.
 *
 * @param error - Error message from write failure
 * @returns Formatted warning message
 */
export function domCacheWriteWarning(error: string): string {
  return `Warning: Failed to write DOM cache: ${error}`;
}

// ============================================================================
// Process Management Messages
// ============================================================================

/**
 * Generate taskkill stderr output message (Windows).
 *
 * @param stderr - Standard error output from taskkill command
 * @returns Formatted diagnostic message
 */
export function taskkillStderr(stderr: string): string {
  return `taskkill stderr: ${stderr}`;
}

/**
 * Generate taskkill failure error message.
 *
 * @param exitCode - Exit code from taskkill
 * @param errorMsg - Error message from stderr/stdout
 * @returns Formatted error message
 */
export function taskkillFailedError(exitCode: number, errorMsg: string): string {
  return `taskkill failed (exit code ${exitCode}): ${errorMsg}`;
}
